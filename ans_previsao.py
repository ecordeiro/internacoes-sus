"""Séries mensais da ANS e a previsão de 2026, no desenho do SUS.

Cada linha do consolidado é uma internação. O mês é o do evento e o
estado é o da pasta, que é o do prestador. O valor pago só existe a
partir de 2023. A contagem usa 24 meses de memória. O valor usa 12,
porque três anos não comportam a janela da contagem. O ticket previsto
é o valor previsto dividido pela previsão de internações.
"""

import json
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq

from datasus import UFS
from modelos_serie import prever

ORIGEM = Path("dados/ans/parquet/cons")
QUEBRAS = Path("dados/ans/quebras.parquet")
MODELOS = Path("dados/ans/modelos")
SAIDA = Path("docs/dados/ans.json")
SUS = Path("docs/dados/previsao.json")
INICIO = "2015-01-01"
FIM = "2025-12-01"
CORTE = "2025-12-01"
INICIO_FUTURO = "2026-01-01"
INICIO_VALOR = "2023-01-01"

CODIGOS = [
    "I839", "O800", "O820", "O829", "N201", "N390", "J342", "N200",
    "Z00", "R068", "O82", "Z000", "R68", "A90", "J353",
]
NOME = {
    "I839": "I839 varizes",
    "O800": "O800 parto normal",
    "O820": "O820 cesárea eletiva",
    "O829": "O829 cesárea",
    "N201": "N201 cálculo no ureter",
    "N390": "N390 infecção urinária",
    "J342": "J342 desvio de septo",
    "N200": "N200 cálculo no rim",
    "Z00": "Z00 exame geral",
    "R068": "R068 outra alteração da respiração",
    "O82": "O82 cesárea",
    "Z000": "Z000 exame geral",
    "R68": "R68 outros sintomas",
    "A90": "A90 dengue",
    "J353": "J353 amígdalas e adenoides",
}
DEMAIS = "Demais diagnósticos"
SEM = "Sem diagnóstico"
ORDEM = {
    "sexo": ["Feminino", "Masculino"],
    "carater": ["Urgência", "Eletiva"],
    "diagnostico": [NOME[codigo] for codigo in CODIGOS] + [DEMAIS, SEM],
    "obito": ["Óbito"],
    "uti": ["Com UTI"],
}
VAZIO = {"", "NAN", "NONE", "NAT", "-2", "<NA>"}


def agregar_arquivo(caminho: Path) -> pd.DataFrame:
    uf = caminho.stem.split("_")[0]
    nomes = set(pq.read_schema(caminho).names)
    colunas = [
        nome
        for nome in (
            "ANO_MES_EVENTO",
            "SEXO",
            "CD_CARATER_ATENDIMENTO",
            "CID_1",
            "CD_MOTIVO_SAIDA",
            "QT_DIARIA_UTI",
            "VL_EVENTO_PAGO",
        )
        if nome in nomes
    ]
    base = pd.read_parquet(caminho, columns=colunas)
    texto = base["ANO_MES_EVENTO"].astype(str).str.strip()
    texto = texto.where(texto.str.contains("-", regex=False), texto.str.slice(0, 4) + "-" + texto.str.slice(4, 6))
    mes = pd.to_datetime(texto.str.slice(0, 7), format="%Y-%m", errors="coerce")
    if "VL_EVENTO_PAGO" in base.columns:
        valor = pd.to_numeric(
            base["VL_EVENTO_PAGO"].astype(str).str.replace(",", ".", regex=False),
            errors="coerce",
        )
    else:
        valor = pd.Series(pd.NA, index=base.index, dtype="Float64")
    sexo = base["SEXO"].astype(str).str.strip()
    sexo = sexo.where(sexo.isin(["Feminino", "Masculino"]))
    carater = base["CD_CARATER_ATENDIMENTO"].astype(str).str.strip().map({"1": "Eletiva", "2": "Urgência"})
    codigo = base["CID_1"].astype(str).str.strip().str.upper()
    vazio = codigo.isin(VAZIO)
    diagnostico = codigo.map(NOME)
    diagnostico = diagnostico.fillna(DEMAIS)
    diagnostico = diagnostico.where(~vazio, SEM)
    saida = base["CD_MOTIVO_SAIDA"].astype(str).str.strip().str.lstrip("0")
    obito = saida.isin(["41", "42", "43"])
    uti = pd.to_numeric(base["QT_DIARIA_UTI"], errors="coerce").fillna(0).gt(0)
    partes = [
        _resumir(uf, mes, valor, pd.Series("Total", index=base.index), "total"),
        _resumir(uf, mes, valor, sexo, "sexo"),
        _resumir(uf, mes, valor, carater, "carater"),
        _resumir(uf, mes, valor, diagnostico, "diagnostico"),
        _resumir(uf, mes, valor, pd.Series("Óbito", index=base.index).where(obito), "obito"),
        _resumir(uf, mes, valor, pd.Series("Com UTI", index=base.index).where(uti), "uti"),
    ]
    partes = [parte for parte in partes if parte is not None]
    return pd.concat(partes, ignore_index=True)


def _resumir(uf: str, mes: pd.Series, valor: pd.Series, grupo: pd.Series, quebra: str) -> pd.DataFrame | None:
    quadro = pd.DataFrame({"mes": mes, "valor": valor, "grupo": grupo})
    quadro = quadro.loc[quadro["grupo"].notna() & quadro["mes"].notna()]
    if quadro.empty:
        return None
    contagem = quadro.groupby(["mes", "grupo"], as_index=False).size().rename(columns={"size": "internacoes"})
    pago = quadro.groupby(["mes", "grupo"], as_index=False)["valor"].sum(min_count=1)
    junto = contagem.merge(pago, on=["mes", "grupo"])
    junto.insert(0, "uf", uf)
    junto.insert(1, "quebra", quebra)
    return junto


def montar(reusar: bool = True) -> pd.DataFrame:
    if reusar and QUEBRAS.exists():
        pronto = pd.read_parquet(QUEBRAS)
        pronto["mes"] = pd.to_datetime(pronto["mes"])
        return pronto
    arquivos = sorted(ORIGEM.glob("*_*.parquet"))
    if not arquivos:
        raise FileNotFoundError(f"Nenhum consolidado em {ORIGEM}")
    partes = []
    for i, caminho in enumerate(arquivos, start=1):
        partes.append(agregar_arquivo(caminho))
        if i % 300 == 0 or i == len(arquivos):
            print(f"{i}/{len(arquivos)} arquivos", flush=True)
    longo = pd.concat(partes, ignore_index=True)
    chave = ["uf", "quebra", "grupo", "mes"]
    contagem = longo.groupby(chave, as_index=False)["internacoes"].sum()
    pago = longo.groupby(chave, as_index=False)["valor"].sum(min_count=1)
    longo = contagem.merge(pago, on=chave)
    longo = longo.loc[longo["mes"].between(INICIO, FIM)].copy()
    QUEBRAS.parent.mkdir(parents=True, exist_ok=True)
    longo.to_parquet(QUEBRAS, index=False)
    return longo


def painel(longo: pd.DataFrame, quebra: str, grupos: list[str] | None = None) -> pd.DataFrame:
    fatia = longo.loc[longo["quebra"].eq(quebra)]
    if grupos is None:
        largo = fatia.pivot(index="mes", columns="uf", values="internacoes")
        colunas = list(UFS)
    else:
        largo = fatia.pivot_table(index="mes", columns=["uf", "grupo"], values="internacoes", fill_value=0)
        colunas = [(uf, grupo) for uf in UFS for grupo in grupos]
        largo = largo.reindex(columns=pd.MultiIndex.from_tuples(colunas, names=["uf", "grupo"]), fill_value=0)
        largo.columns = [f"{uf}|{grupo}" for uf, grupo in largo.columns]
        colunas = list(largo.columns)
    meses = pd.date_range(INICIO, FIM, freq="MS")
    return largo.reindex(index=meses, columns=colunas).fillna(0).astype(int)


def treinar(quadro: pd.DataFrame, nome: str, janela: int = 24) -> tuple[pd.DataFrame, pd.DataFrame]:
    tft_caminho = MODELOS / f"previsao_{nome}_tft.parquet"
    lstm_caminho = MODELOS / f"previsao_{nome}_lstm.parquet"
    if tft_caminho.exists() and lstm_caminho.exists():
        print(f"{nome}: previsão já gravada", flush=True)
        return pd.read_parquet(tft_caminho), pd.read_parquet(lstm_caminho)
    MODELOS.mkdir(parents=True, exist_ok=True)
    return prever(quadro, MODELOS, nome, corte=CORTE, inicio_futuro=INICIO_FUTURO, janela=janela)


def painel_valor(longo: pd.DataFrame) -> pd.DataFrame:
    fatia = longo.loc[longo["quebra"].eq("total") & longo["mes"].between(INICIO_VALOR, FIM)]
    largo = fatia.pivot(index="mes", columns="uf", values="valor")
    meses = pd.date_range(INICIO_VALOR, FIM, freq="MS")
    return largo.reindex(index=meses, columns=list(UFS)).astype(float)


def inteiros(valores) -> list[int]:
    return [int(round(max(float(valor), 0))) for valor in valores]


def pacote(observado: pd.Series, tft: pd.Series, lstm: pd.Series) -> dict:
    return {
        "observado": inteiros(observado),
        "tft": inteiros(tft),
        "lstm": inteiros(lstm),
        "ano_anterior": inteiros(observado.iloc[-12:]),
    }


def gravar(longo: pd.DataFrame, modelos: dict[str, tuple[pd.DataFrame, pd.DataFrame]]) -> None:
    nomes = {estado["sigla"]: estado["nome"] for estado in json.loads(SUS.read_text(encoding="utf-8"))["estados"]}
    meses = [f"{mes:%Y-%m}" for mes in pd.date_range(INICIO, FIM, freq="MS")]
    horizonte = [f"{mes:%Y-%m}" for mes in pd.date_range(INICIO_FUTURO, periods=12, freq="MS")]
    total = painel(longo, "total")
    tft, lstm = modelos["total"]
    estados = []
    for uf in UFS:
        estados.append({"sigla": uf, "nome": nomes[uf], **pacote(total[uf], tft[uf], lstm[uf])})
    quebras = {}
    for quebra, grupos in ORDEM.items():
        quadro = painel(longo, quebra, grupos)
        tft, lstm = modelos[quebra]
        series = {uf: {} for uf in UFS}
        for coluna in quadro.columns:
            uf, grupo = coluna.split("|", 1)
            series[uf][grupo] = pacote(quadro[coluna], tft[coluna], lstm[coluna])
        quebras[quebra] = {"grupos": grupos, "series": series}
    valor_meses = pd.date_range(INICIO_VALOR, FIM, freq="MS")
    valor = {}
    fatia = longo.loc[longo["quebra"].eq("total") & longo["mes"].ge(INICIO_VALOR)]
    for uf in UFS:
        pedaco = fatia.loc[fatia["uf"].eq(uf)].set_index("mes").reindex(valor_meses)
        pago = pedaco["valor"].astype(float)
        quantidade = pedaco["internacoes"].astype(float)
        ticket = pago.div(quantidade.where(quantidade.gt(0)))
        valor[uf] = {
            "valor": [None if pd.isna(item) else int(round(item)) for item in pago],
            "ticket": [None if pd.isna(item) else round(float(item), 2) for item in ticket],
        }
        if "valor" in modelos:
            valor_tft, valor_lstm = modelos["valor"]
            contagem_tft, contagem_lstm = modelos["total"]
            ticket_tft = valor_tft[uf].to_numpy() / contagem_tft[uf].clip(lower=1).to_numpy()
            ticket_lstm = valor_lstm[uf].to_numpy() / contagem_lstm[uf].clip(lower=1).to_numpy()
            valor[uf].update({
                "valor_tft": inteiros(valor_tft[uf]),
                "valor_lstm": inteiros(valor_lstm[uf]),
                "valor_ano_anterior": inteiros(pago.iloc[-12:]),
                "ticket_tft": [round(float(item), 2) for item in ticket_tft],
                "ticket_lstm": [round(float(item), 2) for item in ticket_lstm],
                "ticket_ano_anterior": [None if pd.isna(item) else round(float(item), 2) for item in ticket.iloc[-12:]],
            })
    payload = {
        "meses": meses,
        "horizonte": horizonte,
        "estados": estados,
        "quebras": quebras,
        "valor": {"meses": [f"{mes:%Y-%m}" for mes in valor_meses], "series": valor},
    }
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    SAIDA.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Página: {SAIDA} ({SAIDA.stat().st_size // 1024} KB)", flush=True)


def main() -> None:
    longo = montar(reusar=True)
    print(longo.groupby("quebra")["internacoes"].sum().to_string(), flush=True)
    modelos = {"total": treinar(painel(longo, "total"), "ans_total")}
    for quebra, grupos in ORDEM.items():
        modelos[quebra] = treinar(painel(longo, quebra, grupos), f"ans_{quebra}")
    modelos["valor"] = treinar(painel_valor(longo), "ans_valor", janela=12)
    gravar(longo, modelos)


if __name__ == "__main__":
    main()
