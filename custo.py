"""Valor aprovado e ticket médio por estado, sem baixar arquivo novo.

A regra é a da série de internações: AIH normal, mês da data de internação,
estado do hospital, até julho de 2026. O ticket de cada mês é o valor
aprovado dividido pelo número de internações. A previsão do ticket é a
previsão do valor dividida pela previsão de internações já publicada.
"""

import json
from pathlib import Path

import pandas as pd

from datasus import UFS
from modelos_serie import prever

CACHE = Path(r"C:\Users\emano\pysus\downloads\ducklake\sih")
DESTINO = Path("dados/valor_mes_uf.parquet")
CONTAGEM = Path("docs/dados/previsao.json")
SAIDA = Path("docs/dados/custos.json")
INICIO = "200807"
FIM = "202607"


def agregar_arquivo(caminho: Path) -> pd.DataFrame | None:
    uf = caminho.name[2:4]
    bruto = pd.read_parquet(caminho, columns=["IDENT", "DT_INTER", "VAL_TOT"])
    ident = bruto["IDENT"].astype(str).str.strip().str.lstrip("0")
    base = bruto.loc[ident.eq("1")].copy()
    mes = base["DT_INTER"].astype(str).str.slice(0, 6)
    valido = mes.str.fullmatch(r"20[0-2][0-9](0[1-9]|1[0-2])")
    base = base.loc[valido]
    mes = mes.loc[valido]
    if base.empty:
        return None
    valor = pd.to_numeric(base["VAL_TOT"], errors="coerce").fillna(0)
    quadro = pd.DataFrame({"uf": uf, "mes": mes, "internacoes": 1, "valor": valor})
    return quadro.groupby(["uf", "mes"], as_index=False).sum()


def montar(reusar: bool = True) -> pd.DataFrame:
    if reusar and DESTINO.exists():
        pronto = pd.read_parquet(DESTINO)
        pronto["mes"] = pd.to_datetime(pronto["mes"])
        return pronto
    arquivos = sorted(CACHE.glob("RD??*.parquet"))
    if not arquivos:
        raise FileNotFoundError(f"Nenhum arquivo RD em {CACHE}")
    partes = []
    for i, caminho in enumerate(arquivos, start=1):
        parte = agregar_arquivo(caminho)
        if parte is not None:
            partes.append(parte)
        if i % 200 == 0 or i == len(arquivos):
            print(f"{i}/{len(arquivos)} arquivos", flush=True)
    longo = pd.concat(partes, ignore_index=True)
    longo = longo.groupby(["uf", "mes"], as_index=False)[["internacoes", "valor"]].sum()
    longo = longo.loc[longo["mes"].between(INICIO, FIM)].copy()
    longo["mes"] = pd.to_datetime(longo["mes"], format="%Y%m")
    DESTINO.parent.mkdir(exist_ok=True)
    longo.to_parquet(DESTINO, index=False)
    return longo


def painel(longo: pd.DataFrame, coluna: str) -> pd.DataFrame:
    largo = longo.pivot(index="mes", columns="uf", values=coluna)
    meses = pd.date_range("2008-07-01", "2026-07-01", freq="MS")
    return largo.reindex(index=meses, columns=list(UFS)).fillna(0)


def serie_ticket(valor: pd.DataFrame, quantidade: pd.DataFrame) -> pd.DataFrame:
    return valor.div(quantidade.where(quantidade.gt(0)))


def inteiros(valores) -> list[int]:
    return [int(round(float(valor))) for valor in valores]


def centavos(valores) -> list[float]:
    return [round(float(valor), 2) for valor in valores]


def gravar(valor_obs: pd.DataFrame, valor_tft: pd.DataFrame, valor_lstm: pd.DataFrame, quantidade: pd.DataFrame) -> None:
    contagem = json.loads(CONTAGEM.read_text(encoding="utf-8"))
    por_sigla = {estado["sigla"]: estado for estado in contagem["estados"]}
    meses = [f"{mes:%Y-%m}" for mes in valor_obs.index]
    horizonte = [f"{mes:%Y-%m}" for mes in valor_tft.index]
    if meses != contagem["meses"] or horizonte != contagem["horizonte"]:
        raise ValueError("O calendário do valor não fecha com a série de internações.")
    series = {"valor": {}, "ticket": {}}
    for uf in UFS:
        estado = por_sigla[uf]
        observado = valor_obs[uf]
        tft = valor_tft[uf]
        lstm = valor_lstm[uf]
        quantidade_obs = quantidade[uf]
        ticket_obs = serie_ticket(observado, quantidade_obs).fillna(0)
        ticket_tft = (tft.to_numpy() / pd.Series(estado["tft"]).clip(lower=1).to_numpy())
        ticket_lstm = (lstm.to_numpy() / pd.Series(estado["lstm"]).clip(lower=1).to_numpy())
        series["valor"][uf] = {
            "observado": inteiros(observado),
            "tft": inteiros(tft),
            "lstm": inteiros(lstm),
            "ano_anterior": inteiros(observado.iloc[-12:]),
        }
        series["ticket"][uf] = {
            "observado": centavos(ticket_obs),
            "tft": centavos(ticket_tft),
            "lstm": centavos(ticket_lstm),
            "ano_anterior": centavos(ticket_obs.iloc[-12:]),
        }
    payload = {"meses": meses, "horizonte": horizonte, "series": series}
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    SAIDA.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Página: {SAIDA} ({SAIDA.stat().st_size // 1024} KB)", flush=True)


def main() -> None:
    longo = montar(reusar=True)
    quantidade = painel(longo, "internacoes")
    valor = painel(longo, "valor")
    tft_caminho = Path("dados/previsao_valor_tft.parquet")
    lstm_caminho = Path("dados/previsao_valor_lstm.parquet")
    if tft_caminho.exists() and lstm_caminho.exists():
        print("valor: previsão já gravada", flush=True)
        valor_tft = pd.read_parquet(tft_caminho)
        valor_lstm = pd.read_parquet(lstm_caminho)
    else:
        valor_tft, valor_lstm = prever(valor, Path("dados"), "valor")
    print(longo.groupby("uf")["valor"].sum().sum())
    gravar(valor, valor_tft, valor_lstm, quantidade)


if __name__ == "__main__":
    main()
