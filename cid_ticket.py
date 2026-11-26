"""Ticket médio por CID no SUS e na ANS, de 2023 a 2025.

Só entra o código que tem internação nos dois sistemas, no mesmo estado.
O valor do SUS é o aprovado da AIH. O da ANS é o pago no evento.
"""

import json
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq

from datasus import UFS

SUS_CACHE = Path(r"C:\Users\emano\pysus\downloads\ducklake\sih")
ANS_CACHE = Path("dados/ans/parquet/cons")
SUS_SAIDA = Path("dados/cid_sus.parquet")
ANS_SAIDA = Path("dados/cid_ans.parquet")
PAGINA = Path("docs/dados/cid.json")
INICIO = "202301"
FIM = "202512"
VAZIO = {"", "NAN", "NONE", "NAT", "-2", "<NA>"}
NOMES = {
    "O800": "parto normal",
    "O809": "parto normal",
    "O820": "cesárea eletiva",
    "O829": "cesárea",
    "O82": "cesárea",
    "J189": "pneumonia",
    "J159": "pneumonia bacteriana",
    "N390": "infecção urinária",
    "I64": "AVC",
    "I500": "insuficiência cardíaca",
    "I509": "insuficiência cardíaca",
    "I200": "angina instável",
    "I219": "infarto",
    "A419": "septicemia",
    "B342": "coronavírus",
    "K409": "hérnia inguinal",
    "Z302": "esterilização",
    "I839": "varizes",
    "N201": "cálculo no ureter",
    "N200": "cálculo no rim",
    "J342": "desvio de septo",
    "Z00": "exame geral",
    "Z000": "exame geral",
    "R068": "outra alteração da respiração",
    "R68": "outros sintomas",
    "A90": "dengue",
    "J353": "amígdalas e adenoides",
}


def codigo_valido(serie: pd.Series) -> pd.Series:
    codigo = serie.astype(str).str.strip().str.upper().str.replace(r"\.0$", "", regex=True).str.replace(".", "", regex=False)
    return codigo.where(~codigo.isin(VAZIO) & codigo.str.fullmatch(r"[A-Z][0-9][0-9A-Z]{1,3}", na=False))


def agregar_sus(reusar: bool = True) -> pd.DataFrame:
    if reusar and SUS_SAIDA.exists():
        return pd.read_parquet(SUS_SAIDA)
    arquivos = []
    for ano in ("23", "24", "25", "26"):
        arquivos.extend(sorted(SUS_CACHE.glob(f"RD??{ano}??.parquet")))
    if not arquivos:
        raise FileNotFoundError(f"Nenhum RD de 2023 a 2026 em {SUS_CACHE}")
    partes = []
    for i, caminho in enumerate(arquivos, start=1):
        uf = caminho.name[2:4]
        bruto = pd.read_parquet(caminho, columns=["IDENT", "DT_INTER", "DIAG_PRINC", "VAL_TOT"])
        ident = bruto["IDENT"].astype(str).str.strip().str.lstrip("0")
        base = bruto.loc[ident.eq("1")]
        mes = base["DT_INTER"].astype(str).str.slice(0, 6)
        base = base.loc[mes.between(INICIO, FIM)]
        if base.empty:
            continue
        cid = codigo_valido(base["DIAG_PRINC"])
        valor = pd.to_numeric(base["VAL_TOT"], errors="coerce").fillna(0)
        quadro = pd.DataFrame({"uf": uf, "cid": cid, "valor": valor}).dropna(subset=["cid"])
        partes.append(quadro.groupby(["uf", "cid"], as_index=False).agg(internacoes=("cid", "size"), valor=("valor", "sum")))
        if i % 200 == 0 or i == len(arquivos):
            print(f"SUS {i}/{len(arquivos)}", flush=True)
    longo = pd.concat(partes, ignore_index=True)
    longo = longo.groupby(["uf", "cid"], as_index=False)[["internacoes", "valor"]].sum()
    SUS_SAIDA.parent.mkdir(exist_ok=True)
    longo.to_parquet(SUS_SAIDA, index=False)
    return longo


def agregar_ans(reusar: bool = True) -> pd.DataFrame:
    if reusar and ANS_SAIDA.exists():
        return pd.read_parquet(ANS_SAIDA)
    arquivos = []
    for ano in ("2023", "2024", "2025"):
        arquivos.extend(sorted(ANS_CACHE.glob(f"*_{ano}??.parquet")))
    if not arquivos:
        raise FileNotFoundError(f"Nenhum consolidado de 2023 a 2025 em {ANS_CACHE}")
    partes = []
    for i, caminho in enumerate(arquivos, start=1):
        uf = caminho.stem.split("_")[0]
        nomes = set(pq.read_schema(caminho).names)
        if "VL_EVENTO_PAGO" not in nomes or "CID_1" not in nomes:
            continue
        base = pd.read_parquet(caminho, columns=["ANO_MES_EVENTO", "CID_1", "VL_EVENTO_PAGO"])
        texto = base["ANO_MES_EVENTO"].astype(str).str.replace("-", "", regex=False).str.slice(0, 6)
        base = base.loc[texto.between(INICIO, FIM)]
        if base.empty:
            continue
        cid = codigo_valido(base["CID_1"])
        valor = pd.to_numeric(base["VL_EVENTO_PAGO"].astype(str).str.replace(",", ".", regex=False), errors="coerce").fillna(0)
        quadro = pd.DataFrame({"uf": uf, "cid": cid, "valor": valor}).dropna(subset=["cid"])
        partes.append(quadro.groupby(["uf", "cid"], as_index=False).agg(internacoes=("cid", "size"), valor=("valor", "sum")))
        if i % 200 == 0 or i == len(arquivos):
            print(f"ANS {i}/{len(arquivos)}", flush=True)
    longo = pd.concat(partes, ignore_index=True)
    longo = longo.groupby(["uf", "cid"], as_index=False)[["internacoes", "valor"]].sum()
    longo.to_parquet(ANS_SAIDA, index=False)
    return longo


def gravar(sus: pd.DataFrame, ans: pd.DataFrame) -> None:
    estados = {}
    for uf in UFS:
        esquerdo = sus.loc[sus["uf"].eq(uf)].set_index("cid")
        direito = ans.loc[ans["uf"].eq(uf)].set_index("cid")
        comum = esquerdo.index.intersection(direito.index)
        linhas = []
        for cid in comum:
            linhas.append({
                "cid": cid,
                "nome": NOMES.get(cid, ""),
                "sus_n": int(esquerdo.at[cid, "internacoes"]),
                "sus_valor": int(round(float(esquerdo.at[cid, "valor"]))),
                "ans_n": int(direito.at[cid, "internacoes"]),
                "ans_valor": int(round(float(direito.at[cid, "valor"]))),
            })
        linhas.sort(key=lambda item: item["sus_n"] + item["ans_n"], reverse=True)
        estados[uf] = linhas
        print(f"{uf}: {len(linhas)} CID em comum", flush=True)
    payload = {"inicio": "2023-01", "fim": "2025-12", "estados": estados}
    PAGINA.parent.mkdir(parents=True, exist_ok=True)
    PAGINA.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Página: {PAGINA} ({PAGINA.stat().st_size // 1024} KB)", flush=True)


def main() -> None:
    gravar(agregar_sus(), agregar_ans())


if __name__ == "__main__":
    main()
