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
  valor: "Valor aprovado da AIH, em reais da época.",
  ticket: "Ticket médio: valor aprovado dividido pelo número de internações.",
};

let total = null;
let quebrasDados = null;
let custos = null;
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
  const encontrado = total.estados.find((item) => item.sigla === sigla);
  return encontrado ? encontrado.nome : sigla;
}

function serieAtual() {
  if (quebraAtual === "valor" || quebraAtual === "ticket") {
    const rotulo = quebraAtual === "valor" ? "valor aprovado" : "ticket médio";
    return {
      fonte: custos,
      nome: `${nomeEstado(estadoEl.value)}, ${rotulo}`,
      valores: custos.series[quebraAtual][estadoEl.value],
    };
  }
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
  const mostra = !["total", "valor", "ticket"].includes(quebraAtual) && quebrasDados;
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

function juntar(partes) {
  if (partes.length <= 1) return partes[0] || "";
  return `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
}

function quaseParado(delta, base) {
  return Math.abs(delta) < Math.max(1, Math.abs(base) * 0.01);
}

function fraseMovimento(delta, base, unidade) {
  const detalhe = ` (${delta >= 0 ? "+" : "−"}${pct1(base ? delta / base : 0)})`;
  if (quaseParado(delta, base)) {
    const lado = delta > 0 ? " para mais" : delta < 0 ? " para menos" : "";
    return `fica praticamente no mesmo patamar, com diferença de ${inteiro(Math.abs(delta))}${lado}${detalhe}`;
  }
  if (delta > 0) return `sobe ${inteiro(delta)}${unidade}${detalhe}`;
  return `cai ${inteiro(Math.abs(delta))}${unidade}${detalhe}`;
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

function periodosAnuais(observado) {
  const meses = total.meses;
  const inicio = meses.findIndex((mes) => mes.endsWith("-08"));
  const periodos = [];
  for (let indice = inicio; indice + 11 < meses.length; indice += 12) {
    const [anoInicio] = meses[indice].split("-");
    const [anoFim] = meses[indice + 11].split("-");
    periodos.push({
      rotulo: `${anoInicio}–${anoFim}`,
      total: soma(observado.slice(indice, indice + 12)),
    });
  }
  return periodos;
}

function itensPrevisao() {
  const extrair = (serie) => ({ base: soma(serie.ano_anterior), agora: soma(serie.tft) });
  const itens = [];
  ["sexo", "carater", "diagnostico"].forEach((quebra) => {
    itensDaQuebra(quebra, extrair).forEach((item) => {
      if (item.nome.startsWith("Demais")) return;
      if (item.base < 100 && Math.abs(item.delta) < 100) return;
      itens.push(item);
    });
  });
  return itens;
}

function paresGrupo(quebra, nome) {
  const serie = quebrasDados.quebras[quebra].series[estadoEl.value][nome];
  if (!serie) return null;
  return {
    nome,
    base: soma(serie.ano_anterior),
    agora: soma(serie.tft),
    delta: soma(serie.tft) - soma(serie.ano_anterior),
  };
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

function comoGrupo(item) {
  const nomes = {
    Feminino: "as internações de mulheres",
    Masculino: "as internações de homens",
    Eletiva: "a internação eletiva",
    Urgência: "a urgência",
    "Acidente ou lesão": "acidente ou lesão",
  };
  return nomes[item.nome] || item.nome;
}

function semSexoRepetido(itens) {
  const feminino = itens.find((item) => item.nome === "Feminino");
  const masculino = itens.find((item) => item.nome === "Masculino");
  if (feminino && masculino && (feminino.delta > 0) === (masculino.delta > 0)) {
    return itens.filter((item) => item.nome !== "Feminino" && item.nome !== "Masculino");
  }
  return itens;
}

function maioresNoSentido(itens, positivo) {
  return itens
    .filter((item) => (positivo ? item.delta > 0 : item.delta < 0))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

function textoPorque(delta, base, itens) {
  if (quaseParado(delta, base)) {
    const sobe = maioresNoSentido(itens, true)[0];
    const desce = maioresNoSentido(itens, false)[0];
    let frase = "O total previsto quase não muda, então não há um grupo que explique uma alta ou uma queda do conjunto.";
    if (sobe && desce) {
      frase += ` Por dentro, o maior deslocamento é ${comoGrupo(sobe)}, com ${inteiro(sobe.delta)} a mais, e ${comoGrupo(desce)}, com ${inteiro(Math.abs(desce.delta))} a menos.`;
    }
    return `${frase} Sexo, caráter e diagnóstico se cruzam: a mesma internação pode contar nas três leituras.`;
  }
  const principais = semSexoRepetido(maioresNoSentido(itens, delta > 0)).slice(0, 3);
  if (!principais.length) {
    return `Os dois sexos acompanham essa ${delta > 0 ? "alta" : "queda"}, sem um caráter ou diagnóstico nomeado que se destaque na previsão.`;
  }
  const pedacos = principais.map((item) => `${comoGrupo(item)} (${inteiro(Math.abs(item.delta))} ${item.delta > 0 ? "a mais" : "a menos"})`);
  const verbo = delta > 0 ? "alta" : "queda";
  let frase = `O que mais acompanha essa ${verbo} é ${juntar(pedacos)}.`;
  frase += " É uma leitura aparente: cada série foi prevista à parte, e uma internação pode entrar em mais de um grupo.";
  const contrario = maioresNoSentido(itens, delta < 0)[0];
  if (contrario && Math.abs(contrario.delta) >= Math.abs(principais[0].delta) * 0.35) {
    frase += ` No outro sentido, ${comoGrupo(contrario)} tem ${inteiro(Math.abs(contrario.delta))} ${contrario.delta > 0 ? "a mais" : "a menos"}.`;
  }
  return frase;
}

function textoTendencia(periodos, previsto) {
  if (periodos.length < 3) return "";
  const ultimos = periodos.slice(-3);
  const passos = [
    ultimos[1].total - ultimos[0].total,
    ultimos[2].total - ultimos[1].total,
  ];
  const piso = ultimos[0].total * 0.01;
  const alta = passos.every((passo) => passo > piso);
  const queda = passos.every((passo) => passo < -piso);
  const delta = previsto - ultimos[2].total;
  const nomes = ultimos.map((periodo) => periodo.rotulo).join(", ");
  if (alta && quaseParado(delta, ultimos[2].total)) {
    return `Os períodos ${nomes} vieram em alta. A previsão segura o nível de ${ultimos[2].rotulo} e não projeta outra alta desse tamanho.`;
  }
  if (queda && quaseParado(delta, ultimos[2].total)) {
    return `Os períodos ${nomes} vieram em queda. A previsão segura o nível de ${ultimos[2].rotulo}.`;
  }
  if (alta && delta > 0) return `A previsão continua a alta dos períodos ${nomes}.`;
  if (queda && delta < 0) return `A previsão continua a queda dos períodos ${nomes}.`;
  if (alta && delta < 0) return `A previsão interrompe a alta dos períodos ${nomes}.`;
  if (queda && delta > 0) return `A previsão interrompe a queda dos períodos ${nomes}.`;
  return "";
}

function sugerir(delta, ultimo, media, previsto, itens) {
  const lista = [];
  const relevante = (valor, baseGrupo) => Math.abs(valor) >= Math.max(200, Math.abs(baseGrupo || ultimo) * 0.02);
  const eletiva = itens.find((item) => item.nome === "Eletiva");
  const urgencia = itens.find((item) => item.nome === "Urgência");
  const partos = itens.filter((item) => ["O800 parto normal", "O809 parto normal", "O829 cesariana"].includes(item.nome));
  const pneumonia = itens.filter((item) => ["J189 pneumonia", "J159 pneumonia bacteriana"].includes(item.nome));
  const somar = (grupo, campo) => grupo.reduce((acumulado, item) => acumulado + item[campo], 0);
  const uti = paresGrupo("uti", "Com UTI");
  const obito = paresGrupo("obito", "Óbito");

  if (quaseParado(delta, ultimo) && previsto > media * 1.03) {
    lista.push("Manter a escala e os leitos do último período. A previsão segue acima da média antiga e não pede outra expansão.");
  } else if (delta < 0 && relevante(delta)) {
    const aindaAlto = previsto > media ? " O número ainda fica acima da média antiga, então a rede atual se mantém." : "";
    lista.push(`Não abrir capacidade permanente com base nesta previsão. O total fica abaixo do último período.${aindaAlto} O ajuste é de escala e de fila, revisto quando os primeiros meses fecharem.`);
  } else if (delta > 0 && relevante(delta)) {
    lista.push("Preparar a rede para um volume maior do que o último período. O número é uma previsão, não uma meta.");
  }

  if (eletiva && eletiva.delta > 0 && relevante(eletiva.delta, eletiva.base)) {
    lista.push("Antecipar a fila eletiva e a agenda cirúrgica. Esse volume dá para ordenar antes da internação.");
  }
  if (lista.length < 3 && urgencia && urgencia.delta > 0 && relevante(urgencia.delta, urgencia.base)) {
    lista.push("Reforçar a porta de urgência. Esse volume não entra por agendamento.");
  }
  if (lista.length < 3 && somar(partos, "delta") > 0 && relevante(somar(partos, "delta"), somar(partos, "base"))) {
    lista.push("Rever leitos de obstetrícia. O aumento aparece nos partos nomeados.");
  }
  if (lista.length < 3 && somar(pneumonia, "delta") > 0 && relevante(somar(pneumonia, "delta"), somar(pneumonia, "base"))) {
    lista.push("Reservar leito clínico para pneumonia nos meses de inverno cobertos pela previsão.");
  }
  if (lista.length < 3 && uti && ultimo && previsto) {
    const antes = (100 * uti.base) / ultimo;
    const depois = (100 * uti.agora) / previsto;
    if (depois > antes + 0.3) {
      lista.push("Conferir a ocupação de UTI. A taxa prevista sobe em relação ao último período.");
    }
  }
  if (lista.length < 3 && obito && ultimo && previsto) {
    const antes = (100 * obito.base) / ultimo;
    const depois = (100 * obito.agora) / previsto;
    if (depois > antes + 0.3) {
      lista.push("A taxa de óbito prevista sobe. O ponto de atenção é a gravidade dos casos, não só a quantidade de leitos.");
    }
  }
  if (!lista.length) {
    lista.push("A previsão não separa um grupo que mude o total o bastante para uma ação própria. O passo útil é repetir a organização do último período.");
  }
  return lista.slice(0, 3);
}

function celula(texto) {
  const coluna = document.createElement("td");
  coluna.textContent = texto;
  return coluna;
}

function periodosSomados(meses, valores) {
  const inicio = meses.findIndex((mes) => mes.endsWith("-08"));
  const periodos = [];
  for (let indice = inicio; indice + 11 < meses.length; indice += 12) {
    const [anoInicio] = meses[indice].split("-");
    const [anoFim] = meses[indice + 11].split("-");
    periodos.push({ rotulo: `${anoInicio}–${anoFim}`, total: soma(valores.slice(indice, indice + 12)) });
  }
  return periodos;
}

function periodosTicket(meses, valor, quantidade) {
  const inicio = meses.findIndex((mes) => mes.endsWith("-08"));
  const periodos = [];
  for (let indice = inicio; indice + 11 < meses.length; indice += 12) {
    const [anoInicio] = meses[indice].split("-");
    const [anoFim] = meses[indice + 11].split("-");
    const internacoes = soma(quantidade.slice(indice, indice + 12));
    const aprovado = soma(valor.slice(indice, indice + 12));
    periodos.push({ rotulo: `${anoInicio}–${anoFim}`, total: internacoes ? aprovado / internacoes : 0 });
  }
  return periodos;
}

function escreverCusto() {
  if (!custos) {
    analiseTexto.appendChild(paragrafo("", "A série de custo ainda não foi publicada.", "olho-analise"));
    return;
  }
  const sigla = estadoEl.value;
  const quantidade = total.estados.find((item) => item.sigla === sigla);
  const valor = custos.series.valor[sigla];
  const meses = custos.meses;
  const corpoAnual = document.querySelector("#tabela-anual tbody");
  const ticket = quebraAtual === "ticket";
  const periodos = ticket
    ? periodosTicket(meses, valor.observado, quantidade.observado)
    : periodosSomados(meses, valor.observado);
  const media = periodos.reduce((acumulado, periodo) => acumulado + periodo.total, 0) / periodos.length;
  const ultimo = periodos[periodos.length - 1].total;
  const previsto = ticket
    ? soma(valor.tft) / Math.max(1, soma(quantidade.tft))
    : soma(valor.tft);
  const formatar = ticket
    ? (item) => item.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : reais;
  let anterior = null;
  periodos.forEach((periodo) => {
    const linha = document.createElement("tr");
    const contraAnterior = anterior === null ? "—" : `${periodo.total >= anterior ? "+" : "−"}${pct1((periodo.total - anterior) / anterior)}`;
    const contraMedia = `${periodo.total >= media ? "+" : "−"}${pct1((periodo.total - media) / media)}`;
    linha.append(celula(periodo.rotulo), celula(formatar(periodo.total)), celula(contraAnterior), celula(contraMedia));
    corpoAnual.appendChild(linha);
    anterior = periodo.total;
  });
  const delta = previsto - ultimo;
  const linhaPrevista = document.createElement("tr");
  linhaPrevista.className = "previsto";
  linhaPrevista.append(
    celula("2026–2027, previsão"),
    celula(formatar(previsto)),
    celula(`${delta >= 0 ? "+" : "−"}${pct1(ultimo ? delta / ultimo : 0)}`),
    celula(`${previsto >= media ? "+" : "−"}${pct1(media ? (previsto - media) / media : 0)}`),
  );
  corpoAnual.appendChild(linhaPrevista);

  const n0 = soma(quantidade.observado.slice(-12));
  const n1 = soma(quantidade.tft);
  const v0 = soma(valor.observado.slice(-12));
  const v1 = soma(valor.tft);
  const t0 = n0 ? v0 / n0 : 0;
  const t1 = n1 ? v1 / n1 : 0;
  const efeitoVolume = (n1 - n0) * t0;
  const efeitoTicket = n0 * (t1 - t0);
  const efeitoCruzado = (n1 - n0) * (t1 - t0);
  const contraMedia = previsto >= media
    ? `${pct1((previsto - media) / media)} acima da média`
    : `${pct1((media - previsto) / media)} abaixo da média`;
  const tendencia = textoTendencia(periodos, previsto);
  analiseTexto.appendChild(paragrafo(
    "",
    `${nomeEstado(sigla)}. ${ticket ? "No gráfico, cada mês é o valor aprovado dividido pelas internações daquele mês. Na tabela, o ticket do período usa a soma dos doze meses." : "Valor aprovado da AIH."} Os números estão em reais da época, sem correção pela inflação. A média de ${formatar(media)} usa só os períodos já observados.`,
    "olho-analise",
  ));
  analiseTexto.appendChild(paragrafo(
    "Previsão",
    `${ticket
      ? `De agosto de 2026 a julho de 2027, o ticket médio do período fica ${formatar(previsto)}`
      : `De agosto de 2026 a julho de 2027, o TFT soma ${formatar(previsto)}`}. Em relação a agosto de 2025 a julho de 2026, ${fraseMovimento(delta, ultimo, ticket ? " reais" : " no valor aprovado")}. Esse nível fica ${contraMedia} dos períodos desde 2008–2009. ${tendencia}`.replace(/\s+/g, " ").trim(),
  ));
  let conta = `A quantidade de internações responde por ${reais(efeitoVolume)} e o ticket médio por ${reais(efeitoTicket)}.`;
  if (Math.abs(efeitoCruzado) >= Math.max(Math.abs(v1 - v0) * 0.1, 1)) {
    conta += ` O efeito dos dois juntos é ${reais(efeitoCruzado)}.`;
  }
  analiseTexto.appendChild(paragrafo(
    "Quantidade e ticket",
    `A variação do valor aprovado no período é ${reais(v1 - v0)}. ${conta} O ticket passa de ${t0.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 })} para ${t1.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`,
  ));
  if (fator() !== 1) {
    const sinal = `${fator() > 1 ? "+" : ""}${Math.round((fator() - 1) * 100)}%`;
    analiseTexto.appendChild(paragrafo("", `A simulação de ${sinal} fica de fora desta leitura e da tabela.`, "olho-analise"));
  }
}

function escreverAnalise() {
  const corpoAnual = document.querySelector("#tabela-anual tbody");
  const tituloColuna = document.querySelector("#tabela-anual thead th:nth-child(2)");
  analiseTexto.replaceChildren();
  if (corpoAnual) corpoAnual.replaceChildren();
  if (!total) return;
  if (quebraAtual === "valor" || quebraAtual === "ticket") {
    if (tituloColuna) tituloColuna.textContent = quebraAtual === "valor" ? "Valor aprovado" : "Ticket médio";
    escreverCusto();
    return;
  }
  if (tituloColuna) tituloColuna.textContent = "Internações";
  if (!quebrasDados) {
    analiseTexto.appendChild(paragrafo("", "A leitura entra quando a tabela termina de carregar.", "olho-analise"));
    return;
  }

  const uf = estadoSelecionado();
  const periodos = periodosAnuais(uf.observado);
  const media = periodos.reduce((acumulado, periodo) => acumulado + periodo.total, 0) / periodos.length;
  const ultimo = soma(uf.ano_anterior);
  const previsto = soma(uf.tft);
  const delta = previsto - ultimo;
  const itens = itensPrevisao();
  const deltaLstm = soma(uf.lstm) - ultimo;
  const avisoLstm = !quaseParado(delta, ultimo) && !quaseParado(deltaLstm, ultimo) && (delta > 0) !== (deltaLstm > 0)
    ? ` O LSTM vai no outro sentido e ${fraseMovimento(deltaLstm, ultimo, " internações")}.`
    : "";

  let anterior = null;
  periodos.forEach((periodo) => {
    const linha = document.createElement("tr");
    const contraAnterior = anterior === null ? "—" : `${periodo.total >= anterior ? "+" : "−"}${pct1((periodo.total - anterior) / anterior)}`;
    const contraMedia = `${periodo.total >= media ? "+" : "−"}${pct1((periodo.total - media) / media)}`;
    linha.append(celula(periodo.rotulo), celula(inteiro(periodo.total)), celula(contraAnterior), celula(contraMedia));
    corpoAnual.appendChild(linha);
    anterior = periodo.total;
  });
  const linhaPrevista = document.createElement("tr");
  linhaPrevista.className = "previsto";
  linhaPrevista.append(
    celula("2026–2027, previsão"),
    celula(inteiro(previsto)),
    celula(`${delta >= 0 ? "+" : "−"}${pct1(delta / ultimo)}`),
    celula(`${previsto >= media ? "+" : "−"}${pct1((previsto - media) / media)}`),
  );
  corpoAnual.appendChild(linhaPrevista);

  const contraMedia = previsto >= media
    ? `${pct1((previsto - media) / media)} acima da média`
    : `${pct1((media - previsto) / media)} abaixo da média`;
  const tendencia = textoTendencia(periodos, previsto);
  analiseTexto.appendChild(paragrafo(
    "",
    `${nomeEstado(uf.sigla)}. Cada linha da tabela é agosto a julho, doze meses, o mesmo tamanho da previsão. A média de ${inteiro(media)} usa só os períodos já observados.`,
    "olho-analise",
  ));
  analiseTexto.appendChild(paragrafo(
    "Previsão",
    `De agosto de 2026 a julho de 2027, o TFT soma ${inteiro(previsto)} internações. Em relação a agosto de 2025 a julho de 2026, ${fraseMovimento(delta, ultimo, " internações")}. Esse total fica ${contraMedia} dos períodos desde 2008–2009.${avisoLstm} ${tendencia}`.trim(),
  ));
  analiseTexto.appendChild(paragrafo("Peso aparente", textoPorque(delta, ultimo, itens)));

  const tituloAcoes = document.createElement("h3");
  tituloAcoes.textContent = "O que dá para preparar";
  analiseTexto.appendChild(tituloAcoes);
  const lista = document.createElement("ul");
  sugerir(delta, ultimo, media, previsto, itens).forEach((texto) => {
    const item = document.createElement("li");
    item.textContent = texto;
    lista.appendChild(item);
  });
  analiseTexto.appendChild(lista);
  analiseTexto.appendChild(paragrafo(
    "",
    "As ações são hipóteses de organização do serviço. A série não demonstra a causa clínica.",
    "olho-analise",
  ));
  if (fator() !== 1) {
    const sinal = `${fator() > 1 ? "+" : ""}${Math.round((fator() - 1) * 100)}%`;
    analiseTexto.appendChild(paragrafo("", `A simulação de ${sinal} fica de fora desta leitura e da tabela.`, "olho-analise"));
  }
}

function desenhar() {
  if (!total) return;
  if (quebraAtual !== "total" && quebraAtual !== "valor" && quebraAtual !== "ticket" && !quebrasDados) {
    resumo.textContent = "A série desta aba ainda não foi publicada.";
    return;
  }
  if ((quebraAtual === "valor" || quebraAtual === "ticket") && !custos) {
    resumo.textContent = "A série de custo ainda não foi publicada.";
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
  const margem = { topo: 16, direita: 16, baixo: 78, esquerda: quebraAtual === "valor" || quebraAtual === "ticket" ? 96 : 72 };
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
    grade += `<text x="${margem.esquerda - 8}" y="${y + 4}" text-anchor="end" fill="#57534e" font-size="12">${formatarNumero(valor)}</text>`;
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
      <td>${formatarNumero(anterior[i])}</td>
      <td>${formatarNumero(tft[i])}</td>
      <td>${formatarNumero(lstm[i])}</td>
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
    return fetch("dados/custos.json");
  })
  .then((resposta) => (resposta && resposta.ok ? resposta.json() : null))
  .then((dados) => {
    custos = dados;
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
