"""Treina LSTM e TFT para cada quebra e grava a tabela da página."""

import json
from pathlib import Path

import pandas as pd

from modelos_serie import CORTE, prever
from quebras import ORDEM, montar, painel

PASTA = Path("dados")
SAIDA = Path("docs/dados/quebras.json")
QUEBRAS = ["sexo", "carater", "diagnostico", "obito", "uti"]


def inteiros(valores) -> list[int]:
    return [int(round(valor)) for valor in valores]


def gravar(longo: pd.DataFrame, previsoes: dict[str, tuple[pd.DataFrame, pd.DataFrame]]) -> None:
    meses = [f"{mes:%Y-%m}" for mes in pd.date_range("2008-07-01", CORTE, freq="MS")]
    horizonte = [f"{mes:%Y-%m}" for mes in pd.date_range("2026-08-01", periods=12, freq="MS")]
    payload = {
        "emissao": "2026-07",
        "meses": meses,
        "horizonte": horizonte,
        "quebras": {},
    }
    for quebra in QUEBRAS:
        observado = painel(longo, quebra)
        tft, lstm = previsoes[quebra]
        referencia = observado.iloc[-12:].copy()
        series = {}
        for coluna in observado.columns:
            uf, grupo = coluna.split("|", 1)
            series.setdefault(uf, {})
            series[uf][grupo] = {
                "observado": inteiros(observado[coluna]),
                "tft": inteiros(tft[coluna]),
                "lstm": inteiros(lstm[coluna]),
                "ano_anterior": inteiros(referencia[coluna]),
            }
        payload["quebras"][quebra] = {"grupos": ORDEM[quebra], "series": series}
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    SAIDA.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Página: {SAIDA} ({SAIDA.stat().st_size // 1024} KB)", flush=True)


def main() -> None:
    longo = montar(reusar=True)
    previsoes = {}
    for quebra in QUEBRAS:
        tft_caminho = PASTA / f"previsao_{quebra}_tft.parquet"
        lstm_caminho = PASTA / f"previsao_{quebra}_lstm.parquet"
        if tft_caminho.exists() and lstm_caminho.exists():
            print(f"{quebra}: previsão já gravada", flush=True)
            previsoes[quebra] = (pd.read_parquet(tft_caminho), pd.read_parquet(lstm_caminho))
            continue
        previsoes[quebra] = prever(painel(longo, quebra), PASTA, quebra)
    gravar(longo, previsoes)


if __name__ == "__main__":
    main()
