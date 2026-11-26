const estadoEl = document.querySelector("#estado");
const grupoEl = document.querySelector("#grupo");
const caixaGrupo = document.querySelector("#caixa-grupo");
const inicioEl = document.querySelector("#inicio");
const cenarioEl = document.querySelector("#cenario");
const cenarioValor = document.querySelector("#cenario-valor");
const caixaCenario = document.querySelector("#caixa-cenario");
const abas = document.querySelector("#abas");
const svg = document.querySelector("#grafico");
const titulo = document.querySelector("#titulo-grafico");
const legenda = document.querySelector("#legenda");
const resumo = document.querySelector("#resumo");
const corpo = document.querySelector("#tabela tbody");
const analiseTexto = document.querySelector("#analise-texto");
const caixaMeses = document.querySelector("#caixa-meses");
const numero = new Intl.NumberFormat("pt-BR");

const TEXTO = {
  total: "Todas as internações do estado.",
  sexo: "Internações separadas em feminino e masculino.",
  carater: "Eletiva ou urgência. A internação sem caráter fica de fora.",
  diagnostico: "Os quinze CID mais frequentes em Minas Gerais, o restante e a internação sem CID.",
  obito: "Internações com motivo de saída por óbito.",
  uti: "Internações com pelo menos uma diária de UTI.",
  valor: "Valor pago no evento, em reais da época, a partir de 2023.",
  ticket: "Ticket médio: valor pago dividido pelo número de internações.",
};

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
let ans = null;
let quebraAtual = "total";

function soma(valores) {
  return valores.reduce((total, valor) => total + valor, 0);
}

function pct1(valor) {
  return `${(Math.abs(valor) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function nomeMes(codigo) {
  const [ano, mes] = codigo.split("-");
  return `${MESES[Number(mes) - 1]} de ${ano}`;
}

function fator() {
  return 1 + Number(cenarioEl.value) / 100;
}

function dinheiro(quebra) {
  return quebra === "valor" || quebra === "ticket";
}

function aplicar(valores) {
  if (!valores) return null;
  const escala = dinheiro(quebraAtual) ? 1 : fator();
  const casas = quebraAtual === "ticket" ? 2 : 0;
  const potencia = 10 ** casas;
  return valores.map((valor) => Math.max(0, Math.round(valor * escala * potencia) / potencia));
}

function formatarNumero(valor) {
  if (quebraAtual === "ticket") {
    return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (quebraAtual === "valor") {
    const absoluto = Math.abs(valor);
    if (absoluto >= 1e9) return `${(valor / 1e9).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} bi`;
    if (absoluto >= 1e6) return `${(valor / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  }
  return numero.format(Math.round(valor));
}

function reais(valor) {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function nomeEstado(sigla) {
  return ans.estados.find((item) => item.sigla === sigla).nome;
}

function serieAtual() {
  const sigla = estadoEl.value;
  if (dinheiro(quebraAtual)) {
    const bloco = ans.valor.series[sigla];
    const rotulo = quebraAtual === "valor" ? "valor pago" : "ticket médio";
    return {
      meses: ans.valor.meses,
      horizonte: [],
      nome: `${nomeEstado(sigla)}, ${rotulo}`,
      valores: {
        observado: quebraAtual === "valor" ? bloco.valor : bloco.ticket,
        tft: null,
        lstm: null,
        ano_anterior: null,
      },
    };
  }
  if (quebraAtual === "total") {
    return {
      meses: ans.meses,
      horizonte: ans.horizonte,
      nome: nomeEstado(sigla),
      valores: ans.estados.find((item) => item.sigla === sigla),
    };
  }
  const quebra = ans.quebras[quebraAtual];
  return {
    meses: ans.meses,
    horizonte: ans.horizonte,
    nome: `${nomeEstado(sigla)}, ${grupoEl.value}`,
    valores: quebra.series[sigla][grupoEl.value],
  };
}

function atualizarGrupo() {
  const mostra = !["total", "obito", "uti", "valor", "ticket"].includes(quebraAtual);
  caixaGrupo.hidden = !mostra;
  caixaCenario.hidden = dinheiro(quebraAtual);
  if (!mostra) return;
  const grupos = ans.quebras[quebraAtual].grupos;
  const atual = grupoEl.value;
  grupoEl.innerHTML = grupos.map((grupo) => `<option>${grupo}</option>`).join("");
  grupoEl.value = grupos.includes(atual) ? atual : grupos[0];
}

function desenhar() {
  if (!ans) return;
  atualizarGrupo();
  const atual = serieAtual();
  const valores = atual.valores;
  const corte = inicioEl.value;
  const primeiro = atual.meses.findIndex((mes) => mes >= corte);
  const meses = atual.meses.slice(primeiro).concat(atual.horizonte);
  const observado = valores.observado.slice(primeiro);
  const previsto = Boolean(valores.tft);
  const tft = aplicar(valores.tft);
  const lstm = aplicar(valores.lstm);
  const anterior = valores.ano_anterior;
  const largura = 1000;
  const altura = 480;
  const margem = { topo: 16, direita: 16, baixo: 78, esquerda: dinheiro(quebraAtual) ? 96 : 72 };
  const internoL = largura - margem.esquerda - margem.direita;
  const internoA = altura - margem.topo - margem.baixo;
  const pontos = observado.concat(tft || [], lstm || [], anterior || []);
  const minimo = Math.min(...pontos);
  const maximo = Math.max(...pontos);
  const folga = (maximo - minimo) * 0.08 || 1;
  const y0 = minimo - folga;
  const y1 = maximo + folga;
  const xDe = (indice) => margem.esquerda + (indice + 0.5) * (internoL / meses.length);
  const yDe = (valor) => margem.topo + (1 - (valor - y0) / (y1 - y0)) * internoA;
  const inicioPrevisao = observado.length;
  let grade = "";
  for (let i = 0; i <= 4; i += 1) {
    const valor = y0 + ((y1 - y0) * i) / 4;
    const y = yDe(valor);
    grade += `<line x1="${margem.esquerda}" x2="${largura - margem.direita}" y1="${y}" y2="${y}" stroke="#efe8dc"></line>`;
    grade += `<text x="${margem.esquerda - 8}" y="${y + 4}" text-anchor="end" fill="#57534e" font-size="12">${formatarNumero(valor)}</text>`;
  }
  const passo = meses.length > 60 ? 6 : meses.length > 36 ? 2 : 1;
  let datas = "";
  meses.forEach((mes, i) => {
    if (i % passo !== 0) return;
    datas += `<text x="0" y="0" fill="#57534e" font-size="11" transform="translate(${xDe(i).toFixed(1)} ${margem.topo + internoA + 8}) rotate(90)">${mes}</text>`;
  });
  const linha = (serie, deslocamento, cor, extra) => {
    const d = serie.map((valor, i) => `${i === 0 ? "M" : "L"} ${xDe(i + deslocamento).toFixed(1)} ${yDe(valor).toFixed(1)}`).join(" ");
    return `<path d="${d}" fill="none" stroke="${cor}" stroke-width="2.2" ${extra}></path>`;
  };
  let faixa = "";
  let previsoes = "";
  if (previsto) {
    const x = xDe(inicioPrevisao) - internoL / meses.length / 2;
    faixa = `<path d="M ${x} ${margem.topo} H ${largura - margem.direita} V ${margem.topo + internoA} H ${x} Z" fill="#f8efe3"></path>`;
    faixa += `<line x1="${x}" x2="${x}" y1="${margem.topo}" y2="${margem.topo + internoA}" stroke="#d6d3d1"></line>`;
    previsoes = linha(anterior, inicioPrevisao, "#6b7280", 'stroke-dasharray="5 4"')
      + linha(tft, inicioPrevisao, "#c45911", "")
      + linha(lstm, inicioPrevisao, "#3f6b24", "");
  }
  svg.setAttribute("viewBox", `0 0 ${largura} ${altura}`);
  svg.innerHTML = `<rect width="${largura}" height="${altura}" fill="#fffcf7"></rect>${grade}${faixa}${linha(observado, 0, "#1f4e79", "")}${previsoes}${datas}`;

  const escala = fator();
  const sinal = escala === 1 ? "0%" : `${escala > 1 ? "+" : ""}${Math.round((escala - 1) * 100)}%`;
  cenarioValor.textContent = sinal;
  const simulacao = previsto && escala !== 1 ? `, com simulação de ${sinal}` : "";
  titulo.textContent = previsto
    ? `${atual.nome}: o azul é o observado até dezembro de 2025. A faixa à direita é a previsão de 2026${simulacao}.`
    : `${atual.nome}: série observada, de janeiro de 2023 a dezembro de 2025.`;
  resumo.textContent = `${TEXTO[quebraAtual]} ${previsto ? "Previsão de janeiro a dezembro de 2026." : "Sem previsão: o histórico de valor pago tem três anos."}`;
  const itens = [["", "observado"]];
  if (previsto) {
    itens.push(["tft", escala === 1 ? "TFT" : `TFT ${sinal}`], ["lstm", escala === 1 ? "LSTM" : `LSTM ${sinal}`], ["anterior", "mesmo mês de 2025"]);
  }
  legenda.innerHTML = itens.map(([classe, texto]) => `<span><i class="amostra ${classe}"></i>${texto}</span>`).join("");
  caixaMeses.hidden = !previsto;
  if (previsto) {
    corpo.innerHTML = atual.horizonte.map((mes, i) => `
      <tr>
        <td>${nomeMes(mes)}</td>
        <td>${formatarNumero(anterior[i])}</td>
        <td>${formatarNumero(tft[i])}</td>
        <td>${formatarNumero(lstm[i])}</td>
      </tr>
    `).join("");
  }
  escreverAnalise();
}

function periodos(meses, valores, modoTicket) {
  const quantidade = ans.estados.find((item) => item.sigla === estadoEl.value).observado;
  const periodosAno = [];
  for (let indice = 0; indice + 11 < meses.length; indice += 12) {
    const ano = meses[indice].slice(0, 4);
    if (modoTicket) {
      const inicio = ans.meses.indexOf(meses[indice]);
      const internacoes = soma(quantidade.slice(inicio, inicio + 12));
      const pago = soma(ans.valor.series[estadoEl.value].valor.slice(indice, indice + 12));
      periodosAno.push({ rotulo: ano, total: internacoes ? pago / internacoes : 0 });
    } else {
      periodosAno.push({ rotulo: ano, total: soma(valores.slice(indice, indice + 12)) });
    }
  }
  return periodosAno;
}

function celula(texto) {
  const item = document.createElement("td");
  item.textContent = texto;
  return item;
}

function paragrafo(rotulo, texto) {
  const item = document.createElement("p");
  item.innerHTML = rotulo ? `<strong>${rotulo}.</strong> ${texto}` : texto;
  return item;
}

function fraseMovimento(delta, base) {
  if (Math.abs(delta) < Math.abs(base) * 0.01) {
    return `fica praticamente no mesmo patamar, com diferença de ${numero.format(Math.round(Math.abs(delta)))}`;
  }
  const sentido = delta > 0 ? "sobe" : "cai";
  return `${sentido} ${numero.format(Math.round(Math.abs(delta)))} (${delta > 0 ? "+" : "−"}${pct1(base ? delta / base : 0)})`;
}

function escreverTabela(linhas, previsto) {
  const corpoAnual = document.querySelector("#tabela-anual tbody");
  const tituloColuna = document.querySelector("#tabela-anual thead th:nth-child(2)");
  corpoAnual.replaceChildren();
  tituloColuna.textContent = quebraAtual === "valor" ? "Valor pago" : quebraAtual === "ticket" ? "Ticket médio" : "Internações";
  const formatar = quebraAtual === "ticket"
    ? (valor) => valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : quebraAtual === "valor" ? reais : (valor) => numero.format(Math.round(valor));
  const media = linhas.reduce((total, linha) => total + linha.total, 0) / linhas.length;
  let anterior = null;
  linhas.forEach((linha) => {
    const tr = document.createElement("tr");
    if (linha.previsto) tr.className = "previsto";
    const contraAnterior = anterior === null ? "—" : `${linha.total >= anterior ? "+" : "−"}${pct1((linha.total - anterior) / anterior)}`;
    const contraMedia = `${linha.total >= media ? "+" : "−"}${pct1((linha.total - media) / media)}`;
    tr.append(celula(linha.rotulo), celula(formatar(linha.total)), celula(contraAnterior), celula(contraMedia));
    corpoAnual.appendChild(tr);
    if (!linha.previsto) anterior = linha.total;
  });
  return { media, ultimo: linhas.filter((linha) => !linha.previsto).at(-1).total };
}

function moverGrupo(quebra, grupo) {
  const serie = ans.quebras[quebra].series[estadoEl.value][grupo];
  const antes = soma(serie.ano_anterior);
  const depois = soma(serie.tft);
  return { grupo, antes, depois, delta: depois - antes };
}

function textoPorque(deltaTotal) {
  const sentido = Math.sign(deltaTotal);
  if (sentido === 0) return "O total previsto quase não muda.";
  const sexo = ans.quebras.sexo.grupos.map((grupo) => moverGrupo("sexo", grupo));
  const juntos = sexo.every((item) => Math.sign(item.delta) === sentido);
  const candidatos = [];
  if (!juntos) candidatos.push(...sexo);
  candidatos.push(...ans.quebras.carater.grupos.map((grupo) => moverGrupo("carater", grupo)));
  const diagnosticos = ans.quebras.diagnostico.grupos
    .filter((grupo) => grupo !== "Demais diagnósticos" && grupo !== "Sem diagnóstico")
    .map((grupo) => moverGrupo("diagnostico", grupo));
  candidatos.push(...diagnosticos);
  const noSentido = candidatos
    .filter((item) => Math.sign(item.delta) === sentido && (item.antes >= 100 || Math.abs(item.delta) >= 100))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3);
  const sem = moverGrupo("diagnostico", "Sem diagnóstico");
  const demais = moverGrupo("diagnostico", "Demais diagnósticos");
  const frases = noSentido.map((item) => `${item.grupo} ${item.delta > 0 ? "sobe" : "cai"} ${numero.format(Math.round(Math.abs(item.delta)))}`);
  let texto = "Cada série foi prevista à parte. ";
  texto += frases.length ? `O maior deslocamento no mesmo sentido é ${frases.join(", ")}.` : "Nenhum grupo nomeado acompanha esse movimento de forma clara.";
  texto += ` Sem diagnóstico ${sem.delta >= 0 ? "sobe" : "cai"} ${numero.format(Math.round(Math.abs(sem.delta)))}.`;
  texto += ` Demais diagnósticos ${demais.delta >= 0 ? "sobem" : "caem"} ${numero.format(Math.round(Math.abs(demais.delta)))}.`;
  if (juntos) texto += " Feminino e masculino se movem juntos, então o sexo não explica o total.";
  return texto;
}

function textoAcao(delta, ultimo, periodosAno) {
  const obstetricos = ["O800 parto normal", "O820 cesárea eletiva", "O829 cesárea", "O82 cesárea"];
  const parto = obstetricos.map((grupo) => moverGrupo("diagnostico", grupo));
  const baseParto = parto.reduce((total, item) => total + item.antes, 0);
  const deltaParto = parto.reduce((total, item) => total + item.delta, 0);
  const eletiva = moverGrupo("carater", "Eletiva");
  const acoes = [];
  const acima = periodosAno.slice(-3).every((item, indice, lista) => indice === 0 || item > lista[indice - 1]);
  if (delta > ultimo * 0.02) acoes.push("Preparar escala acima do último ano. A previsão não é um teto.");
  else if (delta < -ultimo * 0.02) acoes.push("Não abrir capacidade permanente. O nível previsto fica abaixo do último ano.");
  else acoes.push("Manter a escala do último ano. A previsão não pede outra expansão.");
  if (Math.abs(eletiva.delta) >= eletiva.antes * 0.02) acoes.push("Rever a fila eletiva. Esse grupo se move mais do que o ruído da própria série.");
  if (baseParto >= 100 && Math.abs(deltaParto) >= baseParto * 0.02) acoes.push("Rever leitos de obstetrícia. O movimento aparece nos partos nomeados.");
  if (acima && delta <= ultimo * 0.02) acoes.push("A alta recente não se repete no mesmo tamanho. O ponto de partida continua sendo o último ano.");
  return acoes.slice(0, 3);
}

function escreverAnalise() {
  analiseTexto.replaceChildren();
  document.querySelector("#analise h2").textContent = dinheiro(quebraAtual) ? "Total do ano" : "Total do ano e a previsão";
  const sigla = estadoEl.value;
  const estado = ans.estados.find((item) => item.sigla === sigla);
  if (dinheiro(quebraAtual)) {
    const linhas = periodos(ans.valor.meses, ans.valor.series[sigla].valor, quebraAtual === "ticket");
    const { media, ultimo } = escreverTabela(linhas, false);
    const formatar = quebraAtual === "ticket"
      ? (valor) => valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : reais;
    analiseTexto.append(
      paragrafo("", `${nomeEstado(sigla)}. ${TEXTO[quebraAtual]} A média de ${formatar(media)} usa 2023, 2024 e 2025.`),
      paragrafo("Histórico", `Em 2025 o total foi ${formatar(ultimo)}, ${ultimo >= media ? `${pct1((ultimo - media) / media)} acima` : `${pct1((media - ultimo) / media)} abaixo`} da média desses três anos. O mesmo modelo da contagem não roda aqui: são só 36 meses.`),
    );
    return;
  }
  const linhas = periodos(ans.meses, estado.observado, false);
  const previsto = soma(estado.tft);
  const { media, ultimo } = escreverTabela(linhas, true);
  const delta = previsto - ultimo;
  const tr = document.createElement("tr");
  tr.className = "previsto";
  tr.append(
    celula("2026, previsão"),
    celula(numero.format(Math.round(previsto))),
    celula(`${delta >= 0 ? "+" : "−"}${pct1(ultimo ? delta / ultimo : 0)}`),
    celula(`${previsto >= media ? "+" : "−"}${pct1(media ? (previsto - media) / media : 0)}`),
  );
  document.querySelector("#tabela-anual tbody").appendChild(tr);
  const contraMedia = previsto >= media
    ? `${pct1((previsto - media) / media)} acima da média`
    : `${pct1((media - previsto) / media)} abaixo da média`;
  const tres = linhas.slice(-3).map((item) => item.rotulo).join(", ");
  const direcao = linhas.slice(-3).every((item, i, lista) => i === 0 || item.total >= lista[i - 1].total)
    ? "em alta"
    : linhas.slice(-3).every((item, i, lista) => i === 0 || item.total <= lista[i - 1].total)
      ? "em queda"
      : "oscilando";
  analiseTexto.append(
    paragrafo("", `${nomeEstado(sigla)}. Cada linha é um ano, de janeiro a dezembro. A média de ${numero.format(Math.round(media))} usa só os anos já observados.`),
    paragrafo("Previsão", `Em 2026, o TFT soma ${numero.format(Math.round(previsto))} internações. Em relação a 2025, ${fraseMovimento(delta, ultimo)}. Esse nível fica ${contraMedia} dos anos desde 2015. Os anos ${tres} vieram ${direcao}.`),
    paragrafo("Peso aparente", textoPorque(delta)),
  );
  const lista = document.createElement("ul");
  textoAcao(delta, ultimo, linhas.slice(-3).map((item) => item.total)).forEach((acao) => {
    const item = document.createElement("li");
    item.textContent = acao;
    lista.appendChild(item);
  });
  const tituloAcao = document.createElement("h3");
  tituloAcao.textContent = "O que dá para preparar";
  analiseTexto.append(tituloAcao, lista, paragrafo("", "As ações são hipóteses de organização do serviço. A série não demonstra a causa clínica."));
  if (fator() !== 1) analiseTexto.append(paragrafo("", "A simulação fica de fora desta leitura e da tabela."));
}

abas.addEventListener("click", (evento) => {
  const botao = evento.target.closest("button");
  if (!botao) return;
  quebraAtual = botao.dataset.quebra;
  abas.querySelectorAll("button").forEach((item) => item.classList.toggle("ativa", item === botao));
  desenhar();
});
estadoEl.addEventListener("change", desenhar);
grupoEl.addEventListener("change", desenhar);
inicioEl.addEventListener("change", desenhar);
cenarioEl.addEventListener("input", desenhar);

fetch("dados/ans.json")
  .then((resposta) => {
    if (!resposta.ok) throw new Error("tabela ausente");
    return resposta.json();
  })
  .then((dados) => {
    ans = dados;
    const ordenados = [...dados.estados].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    estadoEl.innerHTML = ordenados.map((uf) => `<option value="${uf.sigla}">${uf.nome}</option>`).join("");
    estadoEl.value = "MG";
    desenhar();
  })
  .catch(() => {
    resumo.textContent = "Não foi possível ler a série da ANS.";
  });
