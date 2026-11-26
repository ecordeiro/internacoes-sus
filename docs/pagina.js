const estadoEl = document.querySelector("#estado");
const grupoEl = document.querySelector("#grupo");
const caixaGrupo = document.querySelector("#caixa-grupo");
const inicioEl = document.querySelector("#inicio");
const cenarioEl = document.querySelector("#cenario");
const cenarioValor = document.querySelector("#cenario-valor");
const resumo = document.querySelector("#resumo");
const titulo = document.querySelector("#titulo-grafico");
const legenda = document.querySelector("#legenda");
const svg = document.querySelector("#grafico");
const corpo = document.querySelector("#tabela tbody");
const abas = document.querySelector("#abas");

const numero = new Intl.NumberFormat("pt-BR");
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const TEXTO = {
  total: "Todas as internações do estado.",
  sexo: "Internações segundo o sexo registrado na AIH.",
  carater: "Urgência, eletiva ou acidente e lesão.",
  diagnostico: "Os quinze diagnósticos principais de maior volume em Minas Gerais. Os outros códigos estão em Demais diagnósticos.",
  obito: "Somente internações com óbito durante a internação.",
  uti: "Somente internações com pelo menos um dia de UTI.",
};

let total = null;
let quebrasDados = null;
let quebraAtual = "total";

function nomeMes(codigo) {
  const [ano, mes] = codigo.split("-");
  return `${MESES[Number(mes) - 1]} de ${ano}`;
}

function fator() {
  return 1 + Number(cenarioEl.value) / 100;
}

function aplicar(valores) {
  const escala = fator();
  return valores.map((valor) => Math.max(0, Math.round(valor * escala)));
}

function nomeEstado(sigla) {
  const encontrado = total.estados.find((item) => item.sigla === sigla);
  return encontrado ? encontrado.nome : sigla;
}

function serieAtual() {
  if (quebraAtual === "total") {
    return {
      fonte: total,
      nome: nomeEstado(estadoEl.value),
      valores: total.estados.find((item) => item.sigla === estadoEl.value),
    };
  }
  const quebra = quebrasDados.quebras[quebraAtual];
  const valores = quebra.series[estadoEl.value][grupoEl.value];
  return {
    fonte: quebrasDados,
    nome: `${nomeEstado(estadoEl.value)}, ${grupoEl.value}`,
    valores,
  };
}

function atualizarGrupo() {
  const mostra = quebraAtual !== "total" && quebrasDados;
  caixaGrupo.hidden = !mostra || quebrasDados.quebras[quebraAtual].grupos.length < 2;
  if (!mostra) return;
  const grupos = quebrasDados.quebras[quebraAtual].grupos;
  const anterior = grupoEl.value;
  grupoEl.innerHTML = grupos.map((grupo) => `<option value="${grupo}">${grupo}</option>`).join("");
  grupoEl.value = grupos.includes(anterior) ? anterior : grupos[0];
}

function desenhar() {
  if (!total) return;
  if (quebraAtual !== "total" && !quebrasDados) {
    resumo.textContent = "A série desta aba ainda não foi publicada.";
    return;
  }
  const atual = serieAtual();
  const fonte = atual.fonte;
  const uf = atual.valores;
  const escala = fator();
  const corte = inicioEl.value;
  const primeiro = fonte.meses.findIndex((mes) => mes >= corte);
  const meses = fonte.meses.slice(primeiro).concat(fonte.horizonte);
  const observado = uf.observado.slice(primeiro);
  const tft = aplicar(uf.tft);
  const lstm = aplicar(uf.lstm);
  const anterior = uf.ano_anterior;

  const largura = 1000;
  const altura = 480;
  const margem = { topo: 16, direita: 16, baixo: 78, esquerda: 72 };
  const internoL = largura - margem.esquerda - margem.direita;
  const internoA = altura - margem.topo - margem.baixo;
  const pontos = observado.concat(tft, lstm, anterior);
  const minimo = Math.min(...pontos);
  const maximo = Math.max(...pontos);
  const folga = (maximo - minimo) * 0.08 || 1;
  const y0 = minimo - folga;
  const y1 = maximo + folga;
  const xDe = (indice) => margem.esquerda + (indice + 0.5) * (internoL / meses.length);
  const yDe = (valor) => margem.topo + (1 - (valor - y0) / (y1 - y0)) * internoA;
  const inicioPrevisao = observado.length;
  const faixa = `M ${xDe(inicioPrevisao) - internoL / meses.length / 2} ${margem.topo} H ${largura - margem.direita} V ${margem.topo + internoA} H ${xDe(inicioPrevisao) - internoL / meses.length / 2} Z`;
  const linha = (valores, deslocamento, cor, extra) => {
    const d = valores.map((valor, i) => `${i === 0 ? "M" : "L"} ${xDe(i + deslocamento).toFixed(1)} ${yDe(valor).toFixed(1)}`).join(" ");
    return `<path d="${d}" fill="none" stroke="${cor}" stroke-width="2.2" ${extra}></path>`;
  };

  let grade = "";
  for (let i = 0; i <= 4; i += 1) {
    const valor = y0 + ((y1 - y0) * i) / 4;
    const y = yDe(valor);
    grade += `<line x1="${margem.esquerda}" x2="${largura - margem.direita}" y1="${y}" y2="${y}" stroke="#efe8dc"></line>`;
    grade += `<text x="${margem.esquerda - 8}" y="${y + 4}" text-anchor="end" fill="#57534e" font-size="12">${numero.format(Math.round(valor))}</text>`;
  }

  const passo = meses.length > 60 ? 6 : meses.length > 36 ? 2 : 1;
  let datas = "";
  meses.forEach((mes, i) => {
    if (i % passo !== 0) return;
    datas += `<text x="0" y="0" fill="#57534e" font-size="11" transform="translate(${xDe(i).toFixed(1)} ${margem.topo + internoA + 8}) rotate(90)">${mes}</text>`;
  });

  svg.setAttribute("viewBox", `0 0 ${largura} ${altura}`);
  svg.innerHTML = `
    <rect width="${largura}" height="${altura}" fill="#fffcf7"></rect>
    ${grade}
    <path d="${faixa}" fill="#f8efe3"></path>
    <line x1="${xDe(inicioPrevisao) - internoL / meses.length / 2}" x2="${xDe(inicioPrevisao) - internoL / meses.length / 2}" y1="${margem.topo}" y2="${margem.topo + internoA}" stroke="#d6d3d1"></line>
    ${linha(observado, 0, "#1f4e79", "")}
    ${linha(anterior, inicioPrevisao, "#6b7280", 'stroke-dasharray="5 4"')}
    ${linha(tft, inicioPrevisao, "#c45911", "")}
    ${linha(lstm, inicioPrevisao, "#3f6b24", "")}
    ${datas}
  `;

  const sinal = escala === 1 ? "0%" : `${escala > 1 ? "+" : ""}${Math.round((escala - 1) * 100)}%`;
  cenarioValor.textContent = sinal;
  titulo.textContent = `${atual.nome}: o azul é o observado até julho de 2026. A faixa à direita é a previsão, com simulação de ${sinal}.`;
  resumo.textContent = `${TEXTO[quebraAtual]} Previsão de agosto de 2026 a julho de 2027.`;
  legenda.innerHTML = [
    ["", "observado"],
    ["tft", escala === 1 ? "TFT" : `TFT ${sinal}`],
    ["lstm", escala === 1 ? "LSTM" : `LSTM ${sinal}`],
    ["anterior", "mesmo mês do ano anterior"],
  ].map(([classe, texto]) => `<span><i class="amostra ${classe}"></i>${texto}</span>`).join("");

  corpo.innerHTML = fonte.horizonte.map((mes, i) => `
    <tr>
      <td>${nomeMes(mes)}</td>
      <td>${numero.format(anterior[i])}</td>
      <td>${numero.format(tft[i])}</td>
      <td>${numero.format(lstm[i])}</td>
    </tr>
  `).join("");
}

fetch("dados/previsao.json")
  .then((resposta) => {
    if (!resposta.ok) throw new Error("tabela ausente");
    return resposta.json();
  })
  .then((dados) => {
    total = dados;
    const ordenados = [...dados.estados].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    estadoEl.innerHTML = ordenados.map((uf) => `<option value="${uf.sigla}">${uf.nome}</option>`).join("");
    estadoEl.value = "SP";
    desenhar();
    return fetch("dados/quebras.json");
  })
  .then((resposta) => (resposta && resposta.ok ? resposta.json() : null))
  .then((dados) => {
    quebrasDados = dados;
    atualizarGrupo();
    desenhar();
  })
  .catch(() => {
    resumo.textContent = "Não foi possível ler a tabela de previsão.";
  });

abas.addEventListener("click", (evento) => {
  const botao = evento.target.closest("button");
  if (!botao) return;
  quebraAtual = botao.dataset.quebra;
  abas.querySelectorAll("button").forEach((item) => item.classList.toggle("ativa", item === botao));
  atualizarGrupo();
  desenhar();
});

estadoEl.addEventListener("change", desenhar);
grupoEl.addEventListener("change", desenhar);
inicioEl.addEventListener("change", desenhar);
cenarioEl.addEventListener("input", desenhar);
