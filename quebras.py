"""Conta internações por estado e por quebra, sem baixar arquivo novo.

A regra é a da série já publicada: AIH normal, mês da data de internação,
estado do hospital. A janela fecha em julho de 2026.
"""

from pathlib import Path

import pandas as pd

from datasus import UFS

CACHE = Path(r"C:\Users\emano\pysus\downloads\ducklake\sih")
DESTINO = Path("dados/quebras.parquet")
INICIO = "200807"
FIM = "202607"
COLUNAS = ["IDENT", "DT_INTER", "SEXO", "CAR_INT", "DIAG_PRINC", "MORTE", "UTI_MES_TO"]
CODIGOS = [
    "O800",
    "J189",
    "N390",
    "I64",
    "O829",
    "I500",
    "O809",
    "I509",
    "Z302",
    "I200",
    "A419",
    "J159",
    "I219",
    "B342",
    "K409",
]
NOME_DIAGNOSTICO = {
    "O800": "O800 parto normal",
    "J189": "J189 pneumonia",
    "N390": "N390 infecção urinária",
    "I64": "I64 AVC",
    "O829": "O829 cesariana",
    "I500": "I500 insuficiência cardíaca",
    "O809": "O809 parto normal",
    "I509": "I509 insuficiência cardíaca",
    "Z302": "Z302 esterilização",
    "I200": "I200 angina instável",
    "A419": "A419 septicemia",
    "J159": "J159 pneumonia bacteriana",
    "I219": "I219 infarto",
    "B342": "B342 coronavírus",
    "K409": "K409 hérnia inguinal",
}
DEMAIS = "Demais diagnósticos"
ORDEM = {
    "sexo": ["Feminino", "Masculino"],
    "carater": ["Urgência", "Eletiva", "Acidente ou lesão"],
    "diagnostico": [NOME_DIAGNOSTICO[codigo] for codigo in CODIGOS] + [DEMAIS],
    "obito": ["Óbito"],
    "uti": ["Com UTI"],
}


def _contagem(mes: pd.Series, grupo: pd.Series, uf: str, quebra: str) -> pd.DataFrame:
    quadro = pd.DataFrame({"mes": mes, "grupo": grupo})
    quadro = quadro.groupby(["mes", "grupo"], observed=True).size().rename("internacoes").reset_index()
    quadro.insert(0, "uf", uf)
    quadro.insert(1, "quebra", quebra)
    return quadro


def agregar_arquivo(caminho: Path) -> list[pd.DataFrame]:
    uf = caminho.name[2:4]
    bruto = pd.read_parquet(caminho, columns=COLUNAS)
    ident = bruto["IDENT"].astype(str).str.strip().str.lstrip("0")
    base = bruto.loc[ident.eq("1")]
    mes = base["DT_INTER"].astype(str).str.slice(0, 6)
    valido = mes.str.fullmatch(r"20[0-2][0-9](0[1-9]|1[0-2])")
    base = base.loc[valido]
    mes = mes.loc[valido]
    if base.empty:
        return []
    sexo = base["SEXO"].astype(str).str.strip().map({"1": "Masculino", "3": "Feminino"})
    carater = base["CAR_INT"].astype(str).str.strip().map({"01": "Eletiva", "02": "Urgência"}).fillna("Acidente ou lesão")
    codigo = base["DIAG_PRINC"].astype(str).str.strip().str.upper().str.replace(r"\.0$", "", regex=True)
    diagnostico = codigo.where(codigo.isin(CODIGOS), DEMAIS).replace(NOME_DIAGNOSTICO)
    partes = [
        _contagem(mes.loc[sexo.notna()], sexo.dropna(), uf, "sexo"),
        _contagem(mes, carater, uf, "carater"),
        _contagem(mes, diagnostico, uf, "diagnostico"),
    ]
    obito = base["MORTE"].astype(str).str.strip().eq("1")
    if obito.any():
        partes.append(_contagem(mes.loc[obito], pd.Series("Óbito", index=mes.index[obito]), uf, "obito"))
    uti = pd.to_numeric(base["UTI_MES_TO"], errors="coerce").fillna(0).gt(0)
    if uti.any():
        partes.append(_contagem(mes.loc[uti], pd.Series("Com UTI", index=mes.index[uti]), uf, "uti"))
    return partes


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
        partes.extend(agregar_arquivo(caminho))
        if i % 200 == 0 or i == len(arquivos):
            print(f"{i}/{len(arquivos)} arquivos", flush=True)
    longo = pd.concat(partes, ignore_index=True)
    longo = longo.groupby(["uf", "quebra", "grupo", "mes"], as_index=False)["internacoes"].sum()
    longo = longo.loc[longo["mes"].between(INICIO, FIM)].copy()
    longo["mes"] = pd.to_datetime(longo["mes"], format="%Y%m")
    DESTINO.parent.mkdir(exist_ok=True)
    longo.to_parquet(DESTINO, index=False)
    return longo


def painel(longo: pd.DataFrame, quebra: str) -> pd.DataFrame:
    fatia = longo.loc[longo["quebra"].eq(quebra)]
    largo = fatia.pivot_table(index="mes", columns=["uf", "grupo"], values="internacoes", fill_value=0)
    meses = pd.date_range("2008-07-01", "2026-07-01", freq="MS")
    colunas = [(uf, grupo) for uf in UFS for grupo in ORDEM[quebra]]
    largo = largo.reindex(index=meses, columns=pd.MultiIndex.from_tuples(colunas, names=["uf", "grupo"]), fill_value=0)
    largo.columns = [f"{uf}|{grupo}" for uf, grupo in largo.columns]
    return largo.astype(int)


if __name__ == "__main__":
    quadro = montar(reusar=False)
    print(quadro.groupby("quebra")["internacoes"].sum().to_string())
