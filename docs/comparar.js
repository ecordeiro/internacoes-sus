const estadoEl = document.querySelector("#estado");
const inicioEl = document.querySelector("#inicio");
const modoEl = document.querySelector("#modo");
const svg = document.querySelector("#grafico");
const titulo = document.querySelector("#titulo-grafico");
const legenda = document.querySelector("#legenda");
const resumo = document.querySelector("#resumo");
const numero = new Intl.NumberFormat("pt-BR");

let sus = null;
let ans = null;

function soma(valores) {
  return valores.reduce((total, valor) => total + valor, 0);
}

function pct1(valor) {
  return `${(Math.abs(valor) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function recorte(base, meses, inicio, fim) {
  const valores = [];
  const eixo = [];
  meses.forEach((mes, indice) => {
    if (mes < inicio || mes > fim) return;
    eixo.push(mes);
    valores.push(base[indice]);
  });
  return { eixo, valores };
}

function indice(valores, meses) {
  const base = [];
  meses.forEach((mes, indice) => {
    if (mes.startsWith("2015")) base.push(valores[indice]);
  });
  const media = soma(base) / base.length;
  return valores.map((valor) => (media ? (valor / media) * 100 : 0));
}

function desenhar() {
  const sigla = estadoEl.value;
  const nome = sus.estados.find((item) => item.sigla === sigla).nome;
  const susMeses = recorte(
    sus.estados.find((item) => item.sigla === sigla).observado,
    sus.meses,
    "2015-01",
    "2025-12",
  );
  const ansMeses = recorte(
    ans.estados.find((item) => item.sigla === sigla).observado,
    ans.meses,
    "2015-01",
    "2025-12",
  );
  const porMes = new Map(ansMeses.eixo.map((mes, indice) => [mes, ansMeses.valores[indice]]));
  const eixo = susMeses.eixo.filter((mes) => porMes.has(mes) && mes >= inicioEl.value);
  let serieSus = eixo.map((mes) => susMeses.valores[susMeses.eixo.indexOf(mes)]);
  let serieAns = eixo.map((mes) => porMes.get(mes));
  if (modoEl.value === "indice") {
    serieSus = indice(susMeses.valores, susMeses.eixo).filter((_, i) => susMeses.eixo[i] >= inicioEl.value);
    serieAns = indice(ansMeses.valores, ansMeses.eixo).filter((_, i) => ansMeses.eixo[i] >= inicioEl.value);
  }
  const largura = 1000;
  const altura = 480;
  const margem = { topo: 16, direita: 16, baixo: 78, esquerda: modoEl.value === "indice" ? 56 : 72 };
  const internoL = largura - margem.esquerda - margem.direita;
  const internoA = altura - margem.topo - margem.baixo;
  const pontos = serieSus.concat(serieAns);
  const minimo = Math.min(...pontos);
  const maximo = Math.max(...pontos);
  const folga = (maximo - minimo) * 0.08 || 1;
  const y0 = Math.max(0, minimo - folga);
  const y1 = maximo + folga;
  const xDe = (i) => margem.esquerda + (i + 0.5) * (internoL / eixo.length);
  const yDe = (valor) => margem.topo + (1 - (valor - y0) / (y1 - y0)) * internoA;
  let grade = "";
  for (let i = 0; i <= 4; i += 1) {
    const valor = y0 + ((y1 - y0) * i) / 4;
    const y = yDe(valor);
    const rotulo = modoEl.value === "indice"
      ? valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 })
      : numero.format(Math.round(valor));
    grade += `<line x1="${margem.esquerda}" x2="${largura - margem.direita}" y1="${y}" y2="${y}" stroke="#efe8dc"></line>`;
    grade += `<text x="${margem.esquerda - 8}" y="${y + 4}" text-anchor="end" fill="#57534e" font-size="12">${rotulo}</text>`;
  }
  const passo = eixo.length > 60 ? 6 : eixo.length > 36 ? 2 : 1;
  let datas = "";
  eixo.forEach((mes, i) => {
    if (i % passo !== 0) return;
    datas += `<text x="0" y="0" fill="#57534e" font-size="11" transform="translate(${xDe(i).toFixed(1)} ${margem.topo + internoA + 8}) rotate(90)">${mes}</text>`;
  });
  const linha = (serie, cor) => {
    const d = serie.map((valor, i) => `${i === 0 ? "M" : "L"} ${xDe(i).toFixed(1)} ${yDe(valor).toFixed(1)}`).join(" ");
    return `<path d="${d}" fill="none" stroke="${cor}" stroke-width="2.2"></path>`;
  };
  svg.setAttribute("viewBox", `0 0 ${largura} ${altura}`);
  svg.innerHTML = `<rect width="${largura}" height="${altura}" fill="#fffcf7"></rect>${grade}${linha(serieSus, "#1f4e79")}${linha(serieAns, "#c45911")}${datas}`;
  const modo = modoEl.value === "indice" ? "índice com 2015 = 100" : "internações";
  titulo.textContent = `${nome}: azul é o SUS e laranja é a ANS, em ${modo}.`;
  resumo.textContent = "A comparação usa janeiro de 2015 a dezembro de 2025, o período em que as duas séries existem.";
  legenda.innerHTML = `<span><i class="amostra"></i>SUS</span><span><i class="amostra tft"></i>ANS</span>`;
  escreverTabela(sigla);
}

function escreverTabela(sigla) {
  const corpo = document.querySelector("#tabela-anual tbody");
  corpo.replaceChildren();
  const susEstado = sus.estados.find((item) => item.sigla === sigla);
  const ansEstado = ans.estados.find((item) => item.sigla === sigla);
  for (let ano = 2015; ano <= 2025; ano += 1) {
    const susAno = soma(susEstado.observado.filter((_, indice) => sus.meses[indice].startsWith(String(ano))));
    const ansAno = soma(ansEstado.observado.filter((_, indice) => ans.meses[indice].startsWith(String(ano))));
    const tr = document.createElement("tr");
    [String(ano), numero.format(susAno), numero.format(ansAno), pct1(susAno ? ansAno / susAno : 0)].forEach((texto, indice) => {
      const td = document.createElement("td");
      td.textContent = texto;
      if (indice === 0) td.style.textAlign = "left";
      tr.appendChild(td);
    });
    corpo.appendChild(tr);
  }
}

function preparar(susDados, ansDados) {
  sus = susDados;
  ans = ansDados;
  const ordenados = [...sus.estados].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  estadoEl.innerHTML = ordenados.map((uf) => `<option value="${uf.sigla}">${uf.nome}</option>`).join("");
  estadoEl.value = "MG";
  desenhar();
}

Promise.all([
  fetch("dados/previsao.json").then((resposta) => resposta.json()),
  fetch("dados/ans.json").then((resposta) => resposta.json()),
])
  .then(([susDados, ansDados]) => preparar(susDados, ansDados))
  .catch(() => {
    resumo.textContent = "Não foi possível ler as duas séries.";
  });

estadoEl.addEventListener("change", desenhar);
inicioEl.addEventListener("change", desenhar);
modoEl.addEventListener("change", desenhar);
