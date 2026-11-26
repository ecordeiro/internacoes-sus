"""LSTM e TFT no mesmo desenho da previsão publicada.

Cada coluna do painel é uma série. O treino vê até julho de 2026.
A previsão são os doze meses seguintes. O valor do mesmo mês do ano
anterior entra como âncora; a rede aprende a correção.
"""

from pathlib import Path

import numpy as np
import pandas as pd
import torch
from lightning.pytorch import Trainer
from pytorch_forecasting import TemporalFusionTransformer, TimeSeriesDataSet
from pytorch_forecasting.data import GroupNormalizer
from pytorch_forecasting.metrics import QuantileLoss
from torch import nn

JANELA = 24
HORIZONTE = 12
SEMENTE = 42
CORTE = "2026-07-01"


class EscalaSerie:
    def __init__(self, base: pd.DataFrame):
        self.media = base.mean()
        self.desvio = base.std().clip(lower=1)

    def aplicar(self, valores: pd.DataFrame) -> pd.DataFrame:
        return (valores - self.media) / self.desvio

    def desfazer(self, serie: str, valores: np.ndarray) -> np.ndarray:
        return valores * float(self.desvio[serie]) + float(self.media[serie])


def calendario(indice: pd.DatetimeIndex) -> np.ndarray:
    angulo = 2 * np.pi * indice.month.to_numpy() / 12
    return np.column_stack([np.sin(angulo), np.cos(angulo)]).astype(np.float32)


def montar_janelas(escalado: pd.DataFrame, t_inicial: int, t_final: int):
    cal = calendario(escalado.index)
    matriz = escalado.to_numpy(dtype=np.float32)
    passados, futuros, saidas, series = [], [], [], []
    for coluna, serie in enumerate(escalado.columns):
        valores = matriz[:, coluna]
        for t in range(t_inicial, t_final + 1):
            quantidade = valores[t - JANELA : t][:, None]
            passados.append(np.hstack([quantidade, cal[t - JANELA : t]]))
            meses = np.arange(t, t + HORIZONTE)
            sazonal = valores[meses - 12][:, None]
            futuros.append(np.hstack([sazonal, cal[meses]]))
            saidas.append(valores[meses])
            series.append(serie)
    return (
        torch.tensor(np.stack(passados), dtype=torch.float32),
        torch.tensor(np.stack(futuros), dtype=torch.float32),
        torch.tensor(np.stack(saidas), dtype=torch.float32),
        series,
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


def estender(fechada: pd.DataFrame, inicio_futuro: str = "2026-08-01") -> tuple[pd.DataFrame, pd.DatetimeIndex]:
    futuro = pd.date_range(inicio_futuro, periods=HORIZONTE, freq="MS")
    lugar = fechada.iloc[-HORIZONTE:].copy()
    lugar.index = futuro
    return pd.concat([fechada, lugar]), futuro


def prever_lstm(painel: pd.DataFrame, futuro: pd.DatetimeIndex, corte: str = CORTE) -> pd.DataFrame:
    treino = painel.loc[:corte]
    escala = EscalaSerie(treino)
    escalado = escala.aplicar(painel)
    inicio = len(treino)
    passado, futuro_x, y, _ = montar_janelas(escalado, JANELA, inicio - HORIZONTE)
    modelo = treinar_lstm(passado, futuro_x, y)
    p_teste, f_teste, _, series = montar_janelas(escalado, inicio, inicio)
    with torch.no_grad():
        previsto = modelo(p_teste, f_teste).numpy()
    quadro = pd.DataFrame(index=futuro, columns=list(painel.columns), dtype=float)
    for i, serie in enumerate(series):
        quadro[serie] = np.clip(escala.desfazer(serie, previsto[i]), 0, None)
    return quadro


def prever_tft(painel: pd.DataFrame, futuro: pd.DatetimeIndex, corte: str = CORTE) -> pd.DataFrame:
    longo = painel.copy()
    longo.columns.name = "serie"
    longo = longo.stack().rename("internacoes").reset_index()
    longo.columns = ["mes", "serie", "internacoes"]
    longo = longo.sort_values(["serie", "mes"])
    longo["mesmo_mes_ano_anterior"] = longo.groupby("serie")["internacoes"].shift(12)
    longo = longo.dropna().reset_index(drop=True)
    longo["time_idx"] = longo.groupby("serie").cumcount()
    angulo = 2 * np.pi * longo["mes"].dt.month / 12
    longo["mes_sin"] = np.sin(angulo)
    longo["mes_cos"] = np.cos(angulo)
    corte_idx = int(longo.loc[longo["mes"] == corte, "time_idx"].iloc[0])
    treino = TimeSeriesDataSet(
        longo[longo.time_idx <= corte_idx],
        time_idx="time_idx",
        target="internacoes",
        group_ids=["serie"],
        max_encoder_length=JANELA,
        min_encoder_length=JANELA,
        max_prediction_length=HORIZONTE,
        min_prediction_length=HORIZONTE,
        time_varying_known_reals=["mes_sin", "mes_cos", "mesmo_mes_ano_anterior"],
        time_varying_unknown_reals=["internacoes"],
        target_normalizer=GroupNormalizer(groups=["serie"]),
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
    quadro = pd.DataFrame(index=futuro, columns=list(painel.columns), dtype=float)
    for i, serie in enumerate(saida.index["serie"]):
        quadro[serie] = np.clip(valores[i], 0, None)
    return quadro


def prever(
    painel_fechado: pd.DataFrame,
    pasta: Path,
    nome: str,
    corte: str = CORTE,
    inicio_futuro: str = "2026-08-01",
) -> tuple[pd.DataFrame, pd.DataFrame]:
    torch.manual_seed(SEMENTE)
    np.random.seed(SEMENTE)
    painel, futuro = estender(painel_fechado, inicio_futuro)
    print(f"{nome}: {painel_fechado.shape[1]} séries. Previsão {futuro.min():%Y-%m} a {futuro.max():%Y-%m}", flush=True)
    lstm = prever_lstm(painel, futuro, corte)
    tft = prever_tft(painel, futuro, corte)
    pasta.mkdir(exist_ok=True)
    lstm.to_parquet(pasta / f"previsao_{nome}_lstm.parquet")
    tft.to_parquet(pasta / f"previsao_{nome}_tft.parquet")
    return tft, lstm
