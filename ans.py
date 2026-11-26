"""Internações da saúde suplementar (ANS, padrão TISS).

Os arquivos mensais estão no FTP de dados abertos, por UF do prestador.
Cada competência pode ter três arquivos:

- ``cons``: uma linha por internação
- ``det``: itens dessa internação (procedimento, medicamento, material, diária)
- ``rem``: modelo de remuneração do evento; a ANS passou a publicar em 2023

A série pública começa em 2015. O consolidado de 2015 não traz valor;
os anos seguintes trazem ``VL_EVENTO_INFORMADO``, ``VL_EVENTO_PAGO`` e
``VL_EVENTO_GLOSA``. A chave entre consolidado, detalhe e remuneração é
``ID_EVENTO_ATENCAO_SAUDE``.

Exemplos
--------
>>> from ans import baixar_tudo
>>> baixar_tudo()  # todos os estados, anos e tipos já publicados

Linha de comando
----------------
python ans.py --uf AC --ano 2025 --listar
python ans.py --uf AC --ano 2025 --mes 1 --tipo cons --saida dados/ans/ac_2025_01.parquet
"""

from __future__ import annotations

import argparse
import io
import re
import sys
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

import pandas as pd

from datasus import UFS, salvar

BASE = "https://dadosabertos.ans.gov.br/FTP/PDA/TISS/HOSPITALAR"
CACHE = Path("dados/ans/zip")
PARQUET = Path("dados/ans/parquet")

TIPOS = {
    "cons": "uma linha por internação",
    "det": "itens da internação: procedimento, material, medicamento, diária",
    "rem": "modelo de remuneração do evento (publicado a partir de 2023)",
}

_ARQUIVO = re.compile(r"([A-Z]{2})_(\d{6})_HOSP_(CONS|DET|REM)\.zip", re.IGNORECASE)


def anos_publicados() -> list[int]:
    """Anos que o FTP da ANS lista na pasta hospitalar."""
    pagina = _baixar_bytes(f"{BASE}/")
    if pagina is None:
        raise FileNotFoundError(BASE)
    anos = sorted({int(ano) for ano in re.findall(r'href="(20\d{2})/"', pagina.decode("utf-8", errors="replace"))})
    if not anos:
        raise FileNotFoundError(f"Nenhum ano encontrado em {BASE}.")
    return anos


def baixar_tudo(rebaixar: bool = False) -> pd.DataFrame:
    """Baixa todo o hospitalar publicado: 27 UFs, todos os anos e os três tipos.

    Cada arquivo vira um parquet em ``dados/ans/parquet/{tipo}/``. O zip fica
    em ``dados/ans/zip``. Rodar de novo continua de onde parou. O detalhado
    do país inteiro ocupa vários GB e pode levar horas.
    """
    anos = anos_publicados()
    print(f"Anos no FTP: {anos[0]}–{anos[-1]}", flush=True)
    partes = []
    for ano in anos:
        print(f"Lendo o índice de {ano}…", flush=True)
        partes.append(listar(list(UFS), ano))
    catalogo = pd.concat(partes, ignore_index=True).drop_duplicates("url")
    catalogo = catalogo.sort_values(["ano", "uf", "mes", "tipo"]).reset_index(drop=True)
    total = len(catalogo)
    print(f"{total:,} arquivos", flush=True)
    for indice, linha in enumerate(catalogo.itertuples(index=False), start=1):
        destino = PARQUET / linha.tipo / f"{linha.uf}_{linha.ano}{linha.mes:02d}.parquet"
        if destino.exists() and not rebaixar:
            print(f"{indice}/{total} já gravado {destino.name}", flush=True)
            continue
        bruto = _zip_local(linha.arquivo, linha.url, rebaixar)
        if bruto is None:
            print(f"{indice}/{total} não publicado: {linha.arquivo}", flush=True)
            continue
        quadro = _ler_zip(bruto, linha.arquivo)
        quadro.insert(0, "competencia", f"{linha.ano}-{int(linha.mes):02d}")
        destino.parent.mkdir(parents=True, exist_ok=True)
        quadro.to_parquet(destino, index=False)
        print(f"{indice}/{total} {linha.arquivo}: {len(quadro):,} linhas", flush=True)
    return catalogo


def listar(uf: str | list[str], ano: int | list[int]) -> pd.DataFrame:
    """Lista os arquivos publicados, sem baixar o microdado."""
    linhas = []
    for estado in _normalizar_ufs(uf):
        for competencia in _normalizar_ints(ano, "ano"):
            pagina = _baixar_bytes(_url_pasta(estado, competencia))
            if pagina is None:
                continue
            texto = pagina.decode("utf-8", errors="replace")
            for nome in _ARQUIVO.findall(texto):
                sigla, aaaamm, tipo = nome
                arquivo = f"{sigla}_{aaaamm}_HOSP_{tipo.upper()}.zip"
                linhas.append(
                    {
                        "uf": sigla.upper(),
                        "ano": int(aaaamm[:4]),
                        "mes": int(aaaamm[4:]),
                        "tipo": tipo.lower(),
                        "arquivo": arquivo,
                        "url": f"{_url_pasta(sigla.upper(), int(aaaamm[:4]))}{arquivo}",
                    }
                )
    if not linhas:
        return pd.DataFrame(columns=["uf", "ano", "mes", "tipo", "arquivo", "url"])
    quadro = pd.DataFrame(linhas).drop_duplicates("url")
    return quadro.sort_values(["uf", "ano", "mes", "tipo"]).reset_index(drop=True)


def internacoes(
    uf: str | list[str],
    ano: int | list[int],
    meses: int | list[int],
    tipo: str = "cons",
    rebaixar: bool = False,
) -> pd.DataFrame:
    """Baixa internações hospitalares da ANS.

    Parameters
    ----------
    uf:
        Sigla da UF do prestador, ou lista. ``UFS`` traz as 27.
    ano:
        Ano ou lista de anos. A série pública começa em 2015.
    meses:
        Mês (1–12) ou lista de meses.
    tipo:
        ``cons`` (padrão, uma internação), ``det`` (itens) ou ``rem``.
    rebaixar:
        Se verdadeiro, ignora o zip já gravado em ``dados/ans/zip``.
    """
    codigo = _normalizar_tipo(tipo)
    pedidos = [
        (estado, competencia, mes)
        for estado in _normalizar_ufs(uf)
        for competencia in _normalizar_ints(ano, "ano")
        for mes in _normalizar_meses(meses)
    ]
    quadros: list[pd.DataFrame] = []
    ausentes: list[str] = []
    for estado, competencia, mes in pedidos:
        nome = f"{estado}_{competencia}{mes:02d}_HOSP_{codigo.upper()}.zip"
        url = f"{_url_pasta(estado, competencia)}{nome}"
        bruto = _zip_local(nome, url, rebaixar)
        if bruto is None:
            ausentes.append(nome)
            print(f"não publicado: {nome}", flush=True)
            continue
        quadro = _ler_zip(bruto, nome)
        quadro.insert(0, "competencia", f"{competencia}-{mes:02d}")
        quadros.append(quadro)
        print(f"{nome}: {len(quadro):,} linhas", flush=True)

    if not quadros:
        raise FileNotFoundError(
            "Nenhum arquivo foi encontrado. "
            + (f"Ausentes: {', '.join(ausentes)}" if ausentes else "")
        )
    return pd.concat(quadros, ignore_index=True)


def _url_pasta(uf: str, ano: int) -> str:
    return f"{BASE}/{ano}/{uf}/"


def _zip_local(nome: str, url: str, rebaixar: bool) -> bytes | None:
    CACHE.mkdir(parents=True, exist_ok=True)
    caminho = CACHE / nome
    if caminho.exists() and not rebaixar:
        return caminho.read_bytes()
    bruto = _baixar_bytes(url)
    if bruto is None:
        return None
    caminho.write_bytes(bruto)
    return bruto


def _baixar_bytes(url: str) -> bytes | None:
    pedido = urllib.request.Request(url, headers={"User-Agent": "internacoes-ans"})
    try:
        with urllib.request.urlopen(pedido, timeout=120) as resposta:
            return resposta.read()
    except urllib.error.HTTPError as erro:
        if erro.code == 404:
            return None
        raise


def _ler_zip(bruto: bytes, nome: str) -> pd.DataFrame:
    try:
        pacote = zipfile.ZipFile(io.BytesIO(bruto))
    except zipfile.BadZipFile as erro:
        raise ValueError(f"{nome} não é um zip válido.") from erro
    partes = []
    for item in pacote.namelist():
        if not item.lower().endswith(".csv"):
            continue
        conteudo = pacote.read(item)
        partes.append(_ler_csv(conteudo))
    if not partes:
        raise ValueError(f"{nome} não contém CSV.")
    return pd.concat(partes, ignore_index=True)


def _ler_csv(conteudo: bytes) -> pd.DataFrame:
    for codificacao in ("utf-8", "latin-1"):
        try:
            texto = conteudo.decode(codificacao)
        except UnicodeDecodeError:
            continue
        return pd.read_csv(io.StringIO(texto), sep=";", dtype=str, keep_default_na=False)
    raise UnicodeDecodeError("utf-8", conteudo, 0, 1, "CSV da ANS sem codificação reconhecida")


def _normalizar_tipo(tipo: str) -> str:
    codigo = str(tipo).strip().lower()
    if codigo not in TIPOS:
        conhecidos = ", ".join(f"{chave} ({texto})" for chave, texto in TIPOS.items())
        raise ValueError(f"Tipo {tipo!r} não existe. Use: {conhecidos}.")
    return codigo


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


def _parse_ints(texto: str) -> list[int]:
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
    parser = argparse.ArgumentParser(description="Baixa internações hospitalares da ANS (TISS).")
    parser.add_argument("--tudo", action="store_true", help="Baixa todos os estados, anos e tipos publicados.")
    parser.add_argument("--uf", help="Sigla ou siglas separadas por vírgula. Ex.: AC ou SP,RJ")
    parser.add_argument("--ano", type=_parse_ints, help="Ano ou anos. Ex.: 2025 ou 2024-2025")
    parser.add_argument("--mes", type=_parse_ints, help="Mês ou meses. Ex.: 1 ou 1-3. Obrigatório para baixar.")
    parser.add_argument("--tipo", default="cons", choices=tuple(TIPOS), help="cons, det ou rem. Padrão: cons")
    parser.add_argument("--listar", action="store_true", help="Só lista os arquivos publicados.")
    parser.add_argument("--rebaixar", action="store_true", help="Baixa de novo mesmo se o zip já estiver em dados/ans/zip.")
    parser.add_argument("--saida", default=None, help="Caminho .parquet ou .csv.")
    args = parser.parse_args(argv)
    if args.tudo:
        baixar_tudo(rebaixar=args.rebaixar)
        return 0
    if not args.uf or not args.ano:
        parser.error("Informe --uf e --ano, ou use --tudo.")
    ufs = [item.strip() for item in args.uf.split(",") if item.strip()]
    if args.listar:
        quadro = listar(uf=ufs, ano=args.ano)
        with pd.option_context("display.max_colwidth", 80, "display.width", 140):
            print(quadro.to_string(index=False) if not quadro.empty else "Nenhum arquivo publicado.")
        print(f"\n{len(quadro):,} arquivos")
        return 0
    if not args.mes:
        parser.error("--mes é obrigatório para baixar. Use --listar para só ver o catálogo.")
    df = internacoes(uf=ufs, ano=args.ano, meses=args.mes, tipo=args.tipo, rebaixar=args.rebaixar)
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
