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
const analiseTexto = document.querySelector("#analise-texto");

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

function soma(valores) {
  return valores.reduce((acumulado, valor) => acumulado + valor, 0);
}

function inteiro(valor) {
  return numero.format(Math.round(valor));
}

function pct1(valor) {
  return `${(Math.abs(valor) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function pctFatia(valor) {
  if (valor > 0 && valor < 0.001) return "menos de 0,1%";
  return pct1(valor);
}

function porCem(valor) {
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function juntar(partes) {
  if (partes.length <= 1) return partes[0] || "";
  return `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
}

function quaseParado(delta, base) {
  return Math.abs(delta) < Math.max(1, Math.abs(base) * 0.01);
}

function fraseMovimento(delta, base, unidade, plural = false) {
  const detalhe = ` (${delta >= 0 ? "+" : "−"}${pct1(base ? delta / base : 0)})`;
  const parado = plural ? "ficam" : "fica";
  const sobe = plural ? "sobem" : "sobe";
  const cai = plural ? "caem" : "cai";
  if (quaseParado(delta, base)) {
    const lado = delta > 0 ? " para mais" : delta < 0 ? " para menos" : "";
    return `${parado} praticamente no mesmo patamar, com diferença de ${inteiro(Math.abs(delta))}${lado}${detalhe}`;
  }
  if (delta > 0) return `${sobe} ${inteiro(delta)}${unidade}${detalhe}`;
  return `${cai} ${inteiro(Math.abs(delta))}${unidade}${detalhe}`;
}

function detalheProprio(item) {
  if (!item.base) return "";
  const proprio = item.delta / item.base;
  if (Math.abs(proprio) >= 5) return ` (a série tinha ${inteiro(item.base)})`;
  const origem = Math.abs(proprio) >= 0.5 ? `, que tinha ${inteiro(item.base)}` : "";
  return ` (${item.delta >= 0 ? "+" : "−"}${pct1(proprio)} na própria série${origem})`;
}

function movimentoCurto(item) {
  const plural = item.nome.startsWith("Demais");
  if (item.delta > 0) return `${plural ? "sobem" : "sobe"} ${inteiro(item.delta)}${detalheProprio(item)}`;
  if (item.delta < 0) return `${plural ? "caem" : "cai"} ${inteiro(Math.abs(item.delta))}${detalheProprio(item)}`;
  return plural ? "não mudam" : "não muda";
}

function fraseFatia(itens) {
  const base = itens.reduce((acumulado, item) => acumulado + item.base, 0);
  const agora = itens.reduce((acumulado, item) => acumulado + item.agora, 0);
  if (!base || !agora) return "";
  const limite = itens.length <= 2 ? 1 : 2;
  const mudancas = itens
    .map((item) => ({
      nome: item.nome,
      antes: item.base / base,
      depois: item.agora / agora,
      deslocamento: item.agora / agora - item.base / base,
    }))
    .filter((item) => Math.abs(item.deslocamento) >= 0.01)
    .sort((a, b) => Math.abs(b.deslocamento) - Math.abs(a.deslocamento))
    .slice(0, limite);
  if (!mudancas.length) return "";
  const partes = mudancas.map((item) => `a fatia de ${item.nome} passa de ${pctFatia(item.antes)} para ${pctFatia(item.depois)}`);
  return ` ${juntar(partes).replace(/^a/, "A")}.`;
}

function paragrafo(titulo, texto, classe) {
  const elemento = document.createElement("p");
  if (classe) elemento.className = classe;
  if (titulo) {
    const destaque = document.createElement("strong");
    destaque.textContent = `${titulo}. `;
    elemento.appendChild(destaque);
  }
  elemento.appendChild(document.createTextNode(texto));
  return elemento;
}

function estadoSelecionado() {
  return total.estados.find((item) => item.sigla === estadoEl.value);
}

function pares(serie, extrair) {
  const par = extrair(serie);
  return { base: par.base, agora: par.agora, delta: par.agora - par.base };
}

function itensDaQuebra(quebra, extrair) {
  const bloco = quebrasDados.quebras[quebra];
  const series = bloco.series[estadoEl.value];
  return bloco.grupos.map((grupo) => ({ nome: grupo, ...pares(series[grupo], extrair) }));
}

function entraNaLeitura(item) {
  return item.base >= 100 || Math.abs(item.delta) >= 100;
}

function textoCorte(itens, historia) {
  const fatia = fraseFatia(itens);
  const visiveis = itens.filter(entraNaLeitura);
  if (!historia) {
    const base = itens.reduce((acumulado, item) => acumulado + item.base, 0);
    const delta = itens.reduce((acumulado, item) => acumulado + item.delta, 0);
    const frases = [...visiveis]
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .map((item) => `${item.nome} ${movimentoCurto(item)}`);
    const lista = frases.length ? ` ${juntar(frases)}.` : "";
    return `A soma ${fraseMovimento(delta, base, " internações")}.${lista}${fatia}`;
  }
  const sobem = visiveis.filter((item) => item.delta >= 0).sort((a, b) => b.delta - a.delta);
  const descem = visiveis.filter((item) => item.delta < 0).sort((a, b) => a.delta - b.delta);
  const alta = sobem.map((item, indice) => (indice === 0
    ? `${item.nome} responde por ${inteiro(item.delta)}`
    : `${item.nome} por ${inteiro(item.delta)}`));
  const baixa = descem.map((item) => `${item.nome} tira ${inteiro(Math.abs(item.delta))}`);
  const corpo = [
    alta.length ? juntar(alta) : "",
    baixa.length ? `${alta.length ? "No sentido contrário, " : ""}${juntar(baixa)}` : "",
  ].filter(Boolean).join(". ");
  return `${corpo}.${fatia}`;
}

function resposta(item) {
  const plural = item.nome.startsWith("Demais");
  if (item.delta >= 0) return `${plural ? "respondem" : "responde"} por ${inteiro(item.delta)}`;
  return `${plural ? "tiram" : "tira"} ${inteiro(Math.abs(item.delta))}`;
}

function textoDiagnostico(itens, historia) {
  const demais = itens.find((item) => item.nome.startsWith("Demais"));
  const nomeados = itens.filter((item) => item !== demais && entraNaLeitura(item));
  const maiores = [...nomeados].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 3);
  const base = itens.reduce((acumulado, item) => acumulado + item.base, 0);
  const delta = itens.reduce((acumulado, item) => acumulado + item.delta, 0);
  const abertura = historia
    ? ""
    : `A soma ${fraseMovimento(delta, base, " internações")}. `;
  const residual = demais
    ? `Demais diagnósticos ${historia ? `${resposta(demais)}${detalheProprio(demais)}` : movimentoCurto(demais)}. `
    : "";
  const lista = maiores.map((item) => `${item.nome} ${historia ? `${resposta(item)}${detalheProprio(item)}` : movimentoCurto(item)}`);
  const nomeadosTexto = lista.length ? `Entre os quinze nomeados, ${juntar(lista)}.` : "";
  return `${abertura}${residual}${nomeadosTexto}${fraseFatia(itens)}`;
}

function textoAcompanha(rotulo, item, totalItem) {
  const taxaAntes = totalItem.base ? (100 * item.base) / totalItem.base : 0;
  const taxaDepois = totalItem.agora ? (100 * item.agora) / totalItem.agora : 0;
  const taxa = porCem(taxaAntes) === porCem(taxaDepois)
    ? `A taxa segue em ${porCem(taxaDepois)} por 100 internações.`
    : `A taxa passa de ${porCem(taxaAntes)} para ${porCem(taxaDepois)} por 100 internações.`;
  let relacao = "";
  if (!quaseParado(totalItem.delta, totalItem.base) && !quaseParado(item.delta, item.base)) {
    const mesmoSentido = item.delta > 0 === totalItem.delta > 0;
    const taxaCai = taxaDepois < taxaAntes - 0.05;
    const taxaSobe = taxaDepois > taxaAntes + 0.05;
    const taxaNoOutroSentido = (item.delta > 0 && taxaCai) || (item.delta < 0 && taxaSobe);
    if (mesmoSentido && taxaNoOutroSentido) relacao = " A contagem vai com o total, e a taxa vai no outro sentido.";
    else if (mesmoSentido) relacao = " O movimento acompanha o total.";
    else relacao = " Esse movimento e o do total vão em sentidos opostos.";
  }
  return `As internações ${rotulo} ${fraseMovimento(item.delta, item.base, "", true)}. ${taxa}${relacao}`;
}

function janelaHistorico() {
  const meses = total.meses;
  const primeiro = Math.max(0, meses.findIndex((mes) => mes >= inicioEl.value));
  const tamanho = meses.length - primeiro;
  if (tamanho < 2) return null;
  if (primeiro >= tamanho) {
    const inicioBase = primeiro - tamanho;
    return {
      base: [inicioBase, primeiro],
      atual: [primeiro, meses.length],
      texto: `De ${nomeMes(meses[primeiro])} a ${nomeMes(meses[meses.length - 1])}, contra ${nomeMes(meses[inicioBase])} a ${nomeMes(meses[primeiro - 1])},`,
      seguido: true,
    };
  }
  const meio = primeiro + Math.floor(tamanho / 2);
  return {
    base: [primeiro, meio],
    atual: [meio, meses.length],
    texto: `O recorte desde ${nomeMes(meses[primeiro])} não tem um período anterior do mesmo tamanho. A comparação usa ${nomeMes(meses[meio])} a ${nomeMes(meses[meses.length - 1])} contra ${nomeMes(meses[primeiro])} a ${nomeMes(meses[meio - 1])}.`,
  };
}

function escreverAnalise() {
  analiseTexto.replaceChildren();
  if (!total) return;
  if (!quebrasDados) {
    analiseTexto.appendChild(paragrafo("", "A leitura das quebras entra quando a tabela termina de carregar.", "olho-analise"));
    return;
  }
  const uf = estadoSelecionado();
  const extrairPrevisao = (serie) => ({ base: soma(serie.ano_anterior), agora: soma(serie.tft) });
  const totalPrevisto = pares(uf, extrairPrevisao);
  const inicioPrevisto = nomeMes(total.horizonte[0]);
  const fimPrevisto = nomeMes(total.horizonte[total.horizonte.length - 1]);
  const inicioBase = nomeMes(total.meses[total.meses.length - total.horizonte.length]);
  const fimBase = nomeMes(total.meses[total.meses.length - 1]);
  const deltaLstm = soma(uf.lstm) - soma(uf.ano_anterior);
  const avisoLstm = !quaseParado(totalPrevisto.delta, totalPrevisto.base)
    && !quaseParado(deltaLstm, totalPrevisto.base)
    && (totalPrevisto.delta > 0) !== (deltaLstm > 0)
    ? ` O LSTM ${fraseMovimento(deltaLstm, totalPrevisto.base, " internações")}.`
    : "";

  analiseTexto.appendChild(paragrafo(
    "",
    `${nomeEstado(uf.sigla)}. Cada bloco usa a própria série: sexo, caráter e diagnóstico leem as mesmas internações por caminhos diferentes, e os números de um bloco não se somam aos de outro.`,
    "olho-analise",
  ));
  analiseTexto.appendChild(paragrafo(
    "Previsão",
    `O TFT de ${inicioPrevisto} a ${fimPrevisto} ${fraseMovimento(totalPrevisto.delta, totalPrevisto.base, " internações")} em relação a ${inicioBase} a ${fimBase}.${avisoLstm}`,
  ));
  analiseTexto.appendChild(paragrafo("Sexo", textoCorte(itensDaQuebra("sexo", extrairPrevisao), false)));
  analiseTexto.appendChild(paragrafo("Caráter", textoCorte(itensDaQuebra("carater", extrairPrevisao), false)));
  analiseTexto.appendChild(paragrafo("Diagnóstico", textoDiagnostico(itensDaQuebra("diagnostico", extrairPrevisao), false)));
  const obitoPrevisto = itensDaQuebra("obito", extrairPrevisao)[0];
  const utiPrevista = itensDaQuebra("uti", extrairPrevisao)[0];
  analiseTexto.appendChild(paragrafo("Óbito", textoAcompanha("com óbito", obitoPrevisto, totalPrevisto)));
  analiseTexto.appendChild(paragrafo("UTI", textoAcompanha("com UTI", utiPrevista, totalPrevisto)));

  const janela = janelaHistorico();
  if (janela) {
    const extrairHistoria = (serie) => ({
      base: soma(serie.observado.slice(janela.base[0], janela.base[1])),
      agora: soma(serie.observado.slice(janela.atual[0], janela.atual[1])),
    });
    const totalHistorico = pares(uf, extrairHistoria);
    analiseTexto.appendChild(paragrafo(
      "Histórico",
      `${janela.texto} ${janela.seguido ? "o" : "O"} observado ${fraseMovimento(totalHistorico.delta, totalHistorico.base, " internações")}. Nesta parte as quebras fecham o total.`,
    ));
    analiseTexto.appendChild(paragrafo("Sexo no histórico", textoCorte(itensDaQuebra("sexo", extrairHistoria), true)));
    analiseTexto.appendChild(paragrafo("Caráter no histórico", textoCorte(itensDaQuebra("carater", extrairHistoria), true)));
    analiseTexto.appendChild(paragrafo("Diagnóstico no histórico", textoDiagnostico(itensDaQuebra("diagnostico", extrairHistoria), true)));
    analiseTexto.appendChild(paragrafo("Óbito no histórico", textoAcompanha("com óbito", itensDaQuebra("obito", extrairHistoria)[0], totalHistorico)));
    analiseTexto.appendChild(paragrafo("UTI no histórico", textoAcompanha("com UTI", itensDaQuebra("uti", extrairHistoria)[0], totalHistorico)));
  }
  if (fator() !== 1) {
    const sinal = `${fator() > 1 ? "+" : ""}${Math.round((fator() - 1) * 100)}%`;
    analiseTexto.appendChild(paragrafo("", `A simulação de ${sinal} fica de fora desta leitura.`, "olho-analise"));
  }
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
  escreverAnalise();
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
