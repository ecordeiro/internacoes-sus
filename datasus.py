"""Leitura de internações hospitalares (SIH) e atendimentos ambulatoriais (SIA).

Usa o PySUS (namespace ``pysus.ftp``), que consulta o catálogo do DATASUS e
devolve um ``pandas.DataFrame``.

Internações hospitalares
    Sistema SIH, grupo ``RD`` (AIH reduzida): uma linha por internação
    financiada pelo SUS.

Atendimentos ambulatoriais
    Sistema SIA, grupo ``PA`` (produção ambulatorial): procedimentos
    ambulatoriais registrados no BPA.

Os arquivos são mensais e por UF. O SIA-PA é muito grande (milhões de linhas
por UF e mês); comece por uma UF e um mês.

Exemplos
--------
>>> from datasus import internacoes, atendimentos
>>> df_int = internacoes(uf="SP", ano=2024, meses=1)
>>> df_amb = atendimentos(uf="SP", ano=2024, meses=1, colunas=["PA_CODUNI", "PA_PROC_ID", "PA_QTDAPR"])

Linha de comando
----------------
python datasus.py sih --uf SP --ano 2024 --mes 1 --saida dados/sih_sp_2024_01.parquet
python datasus.py sia --uf SP --ano 2024 --mes 1 --listar
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

UFS = (
    "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS",
    "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC",
    "SE", "SP", "TO",
)

# Grupos do SIH (Sistema de Informações Hospitalares). RD é a internação.
GRUPOS_SIH = {
    "RD": "AIH reduzida — uma linha por internação",
    "SP": "serviços profissionais realizados na internação",
    "RJ": "AIH rejeitada",
    "ER": "AIH com erro de preenchimento",
}

# Grupos do SIA (Sistema de Informações Ambulatoriais). PA é o atendimento.
GRUPOS_SIA = {
    "PA": "produção ambulatorial (BPA)",
    "BI": "boletim de produção ambulatorial individualizado",
    "AB": "APAC de acompanhamento",
    "AC": "APAC de confecção de fístula arteriovenosa",
    "AD": "APAC de laudos diversos",
    "AM": "APAC de medicamentos",
    "AN": "APAC de nefrologia",
    "AQ": "APAC de quimioterapia",
    "AR": "APAC de radioterapia",
    "AT": "APAC de tratamento",
    "PS": "atenção psicossocial",
    "SAD": "serviço de atenção domiciliar",
}


def internacoes(
    uf: str | list[str],
    ano: int | list[int],
    meses: int | list[int],
    grupo: str = "RD",
    colunas: list[str] | None = None,
    fonte: str = "catalog",
    listar: bool = False,
) -> pd.DataFrame:
    """Baixa internações hospitalares do SIH.

    Parameters
    ----------
    uf:
        Sigla da UF ou lista de siglas (``"SP"`` ou ``["SP", "RJ"]``).
    ano:
        Ano ou lista de anos.
    meses:
        Mês (1–12) ou lista de meses.
    grupo:
        Arquivo do SIH. O padrão ``RD`` é a AIH reduzida (a internação).
    colunas:
        Subconjunto de colunas. ``None`` traz o arquivo inteiro.
    fonte:
        ``"catalog"`` usa o espelho em parquet (padrão do PySUS).
        ``"origin"`` lê o FTP do DATASUS.
    listar:
        Se verdadeiro, só lista os arquivos, sem baixar os microdados.
    """
    import pysus

    return _buscar(
        pysus.ftp.sih,
        sistema="SIH",
        grupos=GRUPOS_SIH,
        uf=uf,
        ano=ano,
        meses=meses,
        grupo=grupo,
        colunas=colunas,
        fonte=fonte,
        listar=listar,
    )


def atendimentos(
    uf: str | list[str],
    ano: int | list[int],
    meses: int | list[int],
    grupo: str = "PA",
    colunas: list[str] | None = None,
    fonte: str = "catalog",
    listar: bool = False,
) -> pd.DataFrame:
    """Baixa atendimentos ambulatoriais do SIA.

    O padrão é o grupo ``PA`` (produção ambulatorial). Os demais grupos
    estão em ``GRUPOS_SIA`` (APAC de medicamentos, quimioterapia, etc.).

    Os parâmetros são os mesmos de :func:`internacoes`.
    """
    import pysus

    return _buscar(
        pysus.ftp.sia,
        sistema="SIA",
        grupos=GRUPOS_SIA,
        uf=uf,
        ano=ano,
        meses=meses,
        grupo=grupo,
        colunas=colunas,
        fonte=fonte,
        listar=listar,
    )


def salvar(df: pd.DataFrame, caminho: str | Path) -> Path:
    """Grava o DataFrame em ``.parquet`` ou ``.csv``."""
    destino = Path(caminho)
    destino.parent.mkdir(parents=True, exist_ok=True)
    sufixo = destino.suffix.lower()
    if sufixo in {".parquet", ".pq"}:
        df.to_parquet(destino, index=False)
    elif sufixo == ".csv":
        df.to_csv(destino, index=False)
    else:
        raise ValueError(f"Extensão não suportada ({sufixo}). Use .parquet ou .csv.")
    return destino


def _buscar(
    fetcher,
    *,
    sistema: str,
    grupos: dict[str, str],
    uf: str | list[str],
    ano: int | list[int],
    meses: int | list[int],
    grupo: str,
    colunas: list[str] | None,
    fonte: str,
    listar: bool,
) -> pd.DataFrame:
    ufs = _normalizar_ufs(uf)
    anos = _normalizar_ints(ano, "ano")
    lista_meses = _normalizar_meses(meses)
    codigo = _normalizar_grupo(grupo, grupos, sistema)

    quadros: list[pd.DataFrame] = []
    for estado in ufs:
        kwargs: dict = {
            "state": estado,
            "year": anos if len(anos) > 1 else anos[0],
            "month": lista_meses if len(lista_meses) > 1 else lista_meses[0],
            "group": codigo,
            "source": fonte,
        }
        if listar:
            kwargs["download"] = False
        else:
            kwargs["as_dataframe"] = True
            if colunas:
                kwargs["columns"] = colunas

        resultado = fetcher(**kwargs)
        if listar:
            quadros.append(_arquivos_para_quadro(resultado, estado, codigo))
        else:
            quadro = _como_dataframe(resultado)
            if not quadro.empty:
                quadros.append(quadro)

    if not quadros:
        return pd.DataFrame()
    return pd.concat(quadros, ignore_index=True)


def _normalizar_ufs(uf: str | list[str]) -> list[str]:
    if isinstance(uf, str):
        brutos = [uf]
    else:
        brutos = list(uf)
    if not brutos:
        raise ValueError("Informe ao menos uma UF.")
    saida = []
    for item in brutos:
        sigla = str(item).strip().upper()
        if sigla not in UFS:
            raise ValueError(f"UF inválida: {item!r}. Use uma de: {', '.join(UFS)}.")
        saida.append(sigla)
    return saida


def _normalizar_ints(valor: int | list[int], nome: str) -> list[int]:
    if isinstance(valor, int):
        numeros = [valor]
    elif isinstance(valor, (list, tuple)):
        numeros = [int(item) for item in valor]
    else:
        raise TypeError(f"{nome} deve ser int ou lista de int, recebido {type(valor).__name__}.")
    if not numeros:
        raise ValueError(f"Informe ao menos um {nome}.")
    return numeros


def _normalizar_meses(meses: int | list[int]) -> list[int]:
    numeros = _normalizar_ints(meses, "meses")
    invalidos = [mes for mes in numeros if mes < 1 or mes > 12]
    if invalidos:
        raise ValueError(f"Mês fora de 1–12: {invalidos}.")
    return numeros


def _normalizar_grupo(grupo: str, grupos: dict[str, str], sistema: str) -> str:
    codigo = str(grupo).strip().upper()
    if codigo not in grupos:
        conhecidos = ", ".join(f"{chave} ({texto})" for chave, texto in grupos.items())
        raise ValueError(f"Grupo {grupo!r} não existe no {sistema}. Use: {conhecidos}.")
    return codigo


def _como_dataframe(resultado) -> pd.DataFrame:
    if resultado is None:
        return pd.DataFrame()
    if isinstance(resultado, pd.DataFrame):
        return resultado
    to_dataframe = getattr(resultado, "to_dataframe", None)
    if callable(to_dataframe):
        return to_dataframe()
    raise TypeError(f"Resposta inesperada do PySUS: {type(resultado).__name__}.")


def _arquivos_para_quadro(bag, uf: str, grupo: str) -> pd.DataFrame:
    linhas = []
    for item in bag or []:
        if isinstance(item, str):
            caminho = item
            nome = Path(item).name
        else:
            caminho = getattr(item, "path", None)
            nome = getattr(item, "name", None)
            caminho = str(caminho) if caminho else str(item)
            nome = nome or Path(caminho).name
        linhas.append({"uf": uf, "grupo": grupo, "arquivo": nome, "caminho": caminho})
    return pd.DataFrame(linhas)


def _parse_ints(texto: str) -> list[int]:
    """Aceita ``1``, ``1,2,3`` e intervalos ``1-3``."""
    numeros: list[int] = []
    for parte in texto.split(","):
        parte = parte.strip()
        if not parte:
            continue
        if "-" in parte:
            inicio, fim = parte.split("-", 1)
            numeros.extend(range(int(inicio), int(fim) + 1))
        else:
            numeros.append(int(parte))
    if not numeros:
        raise argparse.ArgumentTypeError("Informe ao menos um número.")
    return numeros


def _comando(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Baixa internações (SIH) ou atendimentos ambulatoriais (SIA) com o PySUS.",
    )
    sub = parser.add_subparsers(dest="sistema", required=True)

    for nome, ajuda, grupo_padrao in (
        ("sih", "Internações hospitalares (SIH, padrão RD).", "RD"),
        ("sia", "Atendimentos ambulatoriais (SIA, padrão PA).", "PA"),
    ):
        cmd = sub.add_parser(nome, help=ajuda)
        cmd.add_argument("--uf", required=True, help="Sigla ou siglas separadas por vírgula. Ex.: SP ou SP,RJ")
        cmd.add_argument("--ano", required=True, type=_parse_ints, help="Ano ou anos. Ex.: 2024 ou 2023-2024")
        cmd.add_argument("--mes", required=True, type=_parse_ints, help="Mês ou meses. Ex.: 1 ou 1-3 ou 1,2,6")
        cmd.add_argument("--grupo", default=grupo_padrao, help=f"Grupo do arquivo. Padrão: {grupo_padrao}")
        cmd.add_argument("--colunas", default=None, help="Colunas separadas por vírgula.")
        cmd.add_argument("--fonte", choices=("catalog", "origin"), default="catalog")
        cmd.add_argument("--listar", action="store_true", help="Só lista os arquivos, sem baixar.")
        cmd.add_argument("--saida", default=None, help="Caminho .parquet ou .csv.")

    args = parser.parse_args(argv)
    ufs = [item.strip() for item in args.uf.split(",") if item.strip()]
    colunas = [item.strip() for item in args.colunas.split(",")] if args.colunas else None
    buscar = internacoes if args.sistema == "sih" else atendimentos
    df = buscar(
        uf=ufs,
        ano=args.ano,
        meses=args.mes,
        grupo=args.grupo,
        colunas=colunas,
        fonte=args.fonte,
        listar=args.listar,
    )
    if args.saida:
        destino = salvar(df, args.saida)
        print(f"{len(df):,} linhas gravadas em {destino}")
    else:
        with pd.option_context("display.max_columns", 12, "display.width", 120):
            print(df.head(20).to_string(index=False))
        print(f"\n{len(df):,} linhas, {df.shape[1]} colunas")
    return 0


if __name__ == "__main__":
    sys.exit(_comando())
