"""Treina com a série fechada e grava a tabela que a página do GitHub Pages lê.

O treino para em julho de 2026. Agosto e setembro de 2026 existem no arquivo,
mas a cobrança ainda está incompleta, então ficam de fora. A previsão é
agosto de 2026 a julho de 2027.
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from lightning.pytorch import Trainer
from pytorch_forecasting import TemporalFusionTransformer, TimeSeriesDataSet
from pytorch_forecasting.data import GroupNormalizer
from pytorch_forecasting.metrics import QuantileLoss
from torch import nn

from datasus import UFS

PASTA = Path("dados")
SAIDA = Path("docs/dados/previsao.json")
JANELA = 24
HORIZONTE = 12
SEMENTE = 42
CORTE = "2026-07-01"
NOMES = {
    "AC": "Acre",
    "AL": "Alagoas",
    "AM": "Amazonas",
    "AP": "Amapá",
    "BA": "Bahia",
    "CE": "Ceará",
    "DF": "Distrito Federal",
    "ES": "Espírito Santo",
    "GO": "Goiás",
    "MA": "Maranhão",
    "MG": "Minas Gerais",
    "MS": "Mato Grosso do Sul",
    "MT": "Mato Grosso",
    "PA": "Pará",
    "PB": "Paraíba",
    "PE": "Pernambuco",
    "PI": "Piauí",
    "PR": "Paraná",
    "RJ": "Rio de Janeiro",
    "RN": "Rio Grande do Norte",
    "RO": "Rondônia",
    "RR": "Roraima",
    "RS": "Rio Grande do Sul",
    "SC": "Santa Catarina",
    "SE": "Sergipe",
    "SP": "São Paulo",
    "TO": "Tocantins",
}


class EscalaEstado:
    def __init__(self, base: pd.DataFrame):
        self.media = base.mean()
        self.desvio = base.std().clip(lower=1)

    def aplicar(self, valores: pd.DataFrame) -> pd.DataFrame:
        return (valores - self.media) / self.desvio

    def desfazer(self, uf: str, valores: np.ndarray) -> np.ndarray:
        return valores * float(self.desvio[uf]) + float(self.media[uf])


def calendario(indice: pd.DatetimeIndex) -> np.ndarray:
    angulo = 2 * np.pi * indice.month.to_numpy() / 12
    return np.column_stack([np.sin(angulo), np.cos(angulo)]).astype(np.float32)


def montar_janelas(escalado: pd.DataFrame, t_inicial: int, t_final: int):
    cal = calendario(escalado.index)
    matriz = escalado.to_numpy(dtype=np.float32)
    passados, futuros, saidas, estados = [], [], [], []
    for coluna, uf in enumerate(escalado.columns):
        serie_uf = matriz[:, coluna]
        for t in range(t_inicial, t_final + 1):
            quantidade = serie_uf[t - JANELA : t][:, None]
            passados.append(np.hstack([quantidade, cal[t - JANELA : t]]))
            meses = np.arange(t, t + HORIZONTE)
            sazonal = serie_uf[meses - 12][:, None]
            futuros.append(np.hstack([sazonal, cal[meses]]))
            saidas.append(serie_uf[meses])
            estados.append(uf)
    return (
        torch.tensor(np.stack(passados), dtype=torch.float32),
        torch.tensor(np.stack(futuros), dtype=torch.float32),
        torch.tensor(np.stack(saidas), dtype=torch.float32),
        estados,
    )


class LSTMInternacoes(nn.Module):
    def __init__(self):
        super().__init__()
        self.lstm = nn.LSTM(input_size=3, hidden_size=64, batch_first=True)
        self.variacao = nn.Linear(64 + 3, 1)
        nn.init.zeros_(self.variacao.weight)
        nn.init.zeros_(self.variacao.bias)

    def forward(self, passado, futuro):
        sequencia, _ = self.lstm(passado)
        estado = sequencia[:, -1, :].unsqueeze(1).expand(-1, futuro.shape[1], -1)
        delta = self.variacao(torch.cat([estado, futuro], dim=-1)).squeeze(-1)
        return futuro[:, :, 0] + delta


def treinar_lstm(passado, futuro, y, epocas=80, lote=128):
    modelo = LSTMInternacoes()
    otimizador = torch.optim.Adam(modelo.parameters(), lr=1e-3)
    perda = nn.MSELoss()
    gerador = torch.Generator().manual_seed(SEMENTE)
    modelo.train()
    for epoca in range(1, epocas + 1):
        ordem = torch.randperm(len(passado), generator=gerador)
        total = 0.0
        for inicio in range(0, len(passado), lote):
            indice = ordem[inicio : inicio + lote]
            otimizador.zero_grad()
            erro = perda(modelo(passado[indice], futuro[indice]), y[indice])
            erro.backward()
            otimizador.step()
            total += erro.item() * len(indice)
        if epoca == 1 or epoca % 20 == 0:
            print(f"LSTM época {epoca:02d}  erro {total / len(passado):.5f}", flush=True)
    modelo.eval()
    return modelo


def serie_fechada() -> tuple[pd.DataFrame, pd.DatetimeIndex]:
    bruto = pd.read_parquet(PASTA / "internacoes_mes_uf.parquet")
    painel = bruto.pivot(index="mes", columns="uf", values="internacoes")
    painel = painel.reindex(columns=list(UFS))
    painel.index = pd.to_datetime(painel.index)
    fechada = painel.reindex(pd.date_range("2008-07-01", CORTE, freq="MS"))
    faltando = int(fechada.isna().sum().sum())
    if faltando:
        raise SystemExit(f"A série fechada tem {faltando} valores ausentes.")
    futuro = pd.date_range("2026-08-01", periods=HORIZONTE, freq="MS")
    lugar = pd.DataFrame(
        {
            uf: [float(fechada.loc[mes - pd.DateOffset(years=1), uf]) for mes in futuro]
            for uf in fechada.columns
        },
        index=futuro,
    )
    return pd.concat([fechada, lugar]), futuro


def prever_lstm(painel: pd.DataFrame, futuro: pd.DatetimeIndex) -> pd.DataFrame:
    treino = painel.loc[:CORTE]
    escala = EscalaEstado(treino)
    escalado = escala.aplicar(painel)
    inicio = len(treino)
    passado, futuro_x, y, _ = montar_janelas(escalado, JANELA, inicio - HORIZONTE)
    modelo = treinar_lstm(passado, futuro_x, y)
    p_teste, f_teste, _, ufs = montar_janelas(escalado, inicio, inicio)
    with torch.no_grad():
        previsto = modelo(p_teste, f_teste).numpy()
    quadro = pd.DataFrame(index=futuro, columns=list(UFS), dtype=float)
    for i, uf in enumerate(ufs):
        quadro[uf] = np.clip(escala.desfazer(uf, previsto[i]), 0, None)
    return quadro


def prever_tft(painel: pd.DataFrame, futuro: pd.DatetimeIndex) -> pd.DataFrame:
    longo = painel.stack().rename("internacoes").reset_index()
    longo.columns = ["mes", "uf", "internacoes"]
    longo = longo.sort_values(["uf", "mes"])
    longo["mesmo_mes_ano_anterior"] = longo.groupby("uf")["internacoes"].shift(12)
    longo = longo.dropna().reset_index(drop=True)
    longo["time_idx"] = longo.groupby("uf").cumcount()
    angulo = 2 * np.pi * longo["mes"].dt.month / 12
    longo["mes_sin"] = np.sin(angulo)
    longo["mes_cos"] = np.cos(angulo)
    corte = int(longo.loc[longo["mes"] == CORTE, "time_idx"].iloc[0])
    treino = TimeSeriesDataSet(
        longo[longo.time_idx <= corte],
        time_idx="time_idx",
        target="internacoes",
        group_ids=["uf"],
        max_encoder_length=JANELA,
        min_encoder_length=JANELA,
        max_prediction_length=HORIZONTE,
        min_prediction_length=HORIZONTE,
        time_varying_known_reals=["mes_sin", "mes_cos", "mesmo_mes_ano_anterior"],
        time_varying_unknown_reals=["internacoes"],
        target_normalizer=GroupNormalizer(groups=["uf"]),
        add_relative_time_idx=True,
        add_target_scales=True,
        add_encoder_length=True,
        randomize_length=False,
    )
    teste = TimeSeriesDataSet.from_dataset(treino, longo, predict=True, stop_randomization=True)
    modelo = TemporalFusionTransformer.from_dataset(
        treino,
        learning_rate=1e-3,
        hidden_size=32,
        attention_head_size=1,
        dropout=0.1,
        hidden_continuous_size=16,
        loss=QuantileLoss(),
    )
    Trainer(
        max_epochs=25,
        accelerator="cpu",
        gradient_clip_val=0.1,
        enable_model_summary=False,
        logger=False,
        enable_checkpointing=False,
        enable_progress_bar=True,
        num_sanity_val_steps=0,
    ).fit(modelo, train_dataloaders=treino.to_dataloader(train=True, batch_size=64, num_workers=0))
    saida = modelo.predict(
        teste.to_dataloader(train=False, batch_size=64, num_workers=0),
        mode="prediction",
        return_index=True,
        trainer_kwargs={"logger": False, "enable_progress_bar": False},
    )
    valores = saida.output.detach().numpy()
    quadro = pd.DataFrame(index=futuro, columns=list(UFS), dtype=float)
    for i, uf in enumerate(saida.index["uf"]):
        quadro[uf] = np.clip(valores[i], 0, None)
    return quadro


def inteiros(serie: pd.Series) -> list[int]:
    return [int(round(valor)) for valor in serie.to_numpy()]


def gravar(painel: pd.DataFrame, futuro: pd.DatetimeIndex, tft: pd.DataFrame, lstm: pd.DataFrame) -> None:
    fechada = painel.loc[:CORTE]
    meses = [f"{mes:%Y-%m}" for mes in fechada.index]
    horizonte = [f"{mes:%Y-%m}" for mes in futuro]
    referencia = fechada.loc[futuro - pd.DateOffset(years=1)].copy()
    referencia.index = futuro
    estados = []
    for uf in UFS:
        estados.append(
            {
                "sigla": uf,
                "nome": NOMES[uf],
                "observado": inteiros(fechada[uf]),
                "tft": inteiros(tft[uf]),
                "lstm": inteiros(lstm[uf]),
                "ano_anterior": inteiros(referencia[uf]),
            }
        )
    payload = {
        "emissao": "2026-07",
        "historico_de": meses[0],
        "historico_ate": meses[-1],
        "meses": meses,
        "horizonte": horizonte,
        "estados": estados,
    }
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    SAIDA.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Tabela gravada em {SAIDA} ({SAIDA.stat().st_size // 1024} KB)", flush=True)


def main() -> None:
    torch.manual_seed(SEMENTE)
    np.random.seed(SEMENTE)
    painel, futuro = serie_fechada()
    print(f"Treino: {painel.index.min():%Y-%m} a {CORTE[:7]}. Previsão: {futuro.min():%Y-%m} a {futuro.max():%Y-%m}", flush=True)
    lstm = prever_lstm(painel, futuro)
    tft = prever_tft(painel, futuro)
    gravar(painel, futuro, tft, lstm)


if __name__ == "__main__":
    main()
