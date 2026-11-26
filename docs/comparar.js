const estadoEl = document.querySelector("#estado");
const inicioEl = document.querySelector("#inicio");
const modoEl = document.querySelector("#modo");
const svg = document.querySelector("#grafico");
const titulo = document.querySelector("#titulo-grafico");
const legenda = document.querySelector("#legenda");
const resumo = document.querySelector("#resumo");
const numero = new Intl.NumberFormat("pt-BR");
const reais = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });

const caixaInicio = document.querySelector("#caixa-inicio");
let sus = null;
let ans = null;
let custos = null;
let cid = null;

function soma(valores) {
  return valores.reduce((total, valor) => total + valor, 0);
}

function pct1(valor) {
  return `${(Math.abs(valor) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function nomeMes(codigo) {
  const [ano, mes] = codigo.split("-");
  const nomes = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  return `${nomes[Number(mes) - 1]} de ${ano}`;
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
  meses.forEach((mes, i) => {
    if (mes.startsWith("2015")) base.push(valores[i]);
  });
  const media = soma(base) / base.length;
  return valores.map((valor) => (media ? (valor / media) * 100 : 0));
}

function somaAno(meses, valores, ano) {
  let total = 0;
  let tem = false;
  meses.forEach((mes, indice) => {
    if (!mes.startsWith(String(ano))) return;
    total += valores[indice];
    tem = true;
  });
  return tem ? total : null;
}

function reaisInteiro(valor) {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function desenharCid() {
  const sigla = estadoEl.value;
  const nome = sus.estados.find((item) => item.sigla === sigla).nome;
  if (!cid) {
    titulo.textContent = "Carregando os CID que existem no SUS e na ANS.";
    resumo.textContent = "O ticket por CID usa janeiro de 2023 a dezembro de 2025.";
    return;
  }
  const linhas = cid.estados[sigla] || [];
  const amostra = linhas.slice(0, 8);
  const largura = 1000;
  const altura = 480;
  const margem = { topo: 16, direita: 16, baixo: 52, esquerda: 88 };
  const internoL = largura - margem.esquerda - margem.direita;
  const internoA = altura - margem.topo - margem.baixo;
  const tickets = amostra.flatMap((item) => [item.sus_n ? item.sus_valor / item.sus_n : 0, item.ans_n ? item.ans_valor / item.ans_n : 0]);
  const maximo = Math.max(...tickets, 1) * 1.08;
  const yDe = (valor) => margem.topo + (1 - valor / maximo) * internoA;
  const passo = amostra.length ? internoL / amostra.length : internoL;
  let grade = "";
  for (let i = 0; i <= 4; i += 1) {
    const valor = (maximo * i) / 4;
    const y = yDe(valor);
    grade += `<line x1="${margem.esquerda}" x2="${largura - margem.direita}" y1="${y}" y2="${y}" stroke="#efe8dc"></line>`;
    grade += `<text x="${margem.esquerda - 8}" y="${y + 4}" text-anchor="end" fill="#57534e" font-size="12">${reaisInteiro(valor)}</text>`;
  }
  let barras = "";
  let datas = "";
  amostra.forEach((item, i) => {
    const x = margem.esquerda + i * passo;
    const susTicket = item.sus_n ? item.sus_valor / item.sus_n : 0;
    const ansTicket = item.ans_n ? item.ans_valor / item.ans_n : 0;
    const larguraBarra = Math.min(18, passo * 0.28);
    const centro = x + passo / 2;
    barras += `<rect x="${(centro - larguraBarra - 2).toFixed(1)}" y="${yDe(susTicket).toFixed(1)}" width="${larguraBarra}" height="${(margem.topo + internoA - yDe(susTicket)).toFixed(1)}" fill="#1f4e79"></rect>`;
    barras += `<rect x="${(centro + 2).toFixed(1)}" y="${yDe(ansTicket).toFixed(1)}" width="${larguraBarra}" height="${(margem.topo + internoA - yDe(ansTicket)).toFixed(1)}" fill="#c45911"></rect>`;
    datas += `<text x="${centro.toFixed(1)}" y="${margem.topo + internoA + 18}" text-anchor="middle" fill="#57534e" font-size="12">${item.cid}</text>`;
  });
  svg.setAttribute("viewBox", `0 0 ${largura} ${altura}`);
  svg.innerHTML = `<rect width="${largura}" height="${altura}" fill="#fffcf7"></rect>${grade}${barras}${datas}`;
  titulo.textContent = linhas.length
    ? `${nome}. Ticket médio de janeiro de 2023 a dezembro de 2025. O gráfico mostra os oito CID com mais internações somadas. A tabela lista os ${numero.format(linhas.length)} códigos que existem nos dois sistemas.`
    : `${nome}. Nenhum CID em comum nesse período.`;
  resumo.textContent = "Cada ticket é o valor do período dividido pelas internações do mesmo CID. No SUS, o valor é o aprovado da AIH. Na ANS, é o pago no evento. Só entra o código presente nos dois.";
  legenda.innerHTML = `<span><i class="amostra"></i>SUS</span><span><i class="amostra tft"></i>ANS</span>`;
  document.querySelector(".analise h2").textContent = "CID em comum";
  const corpo = document.querySelector("#tabela-anual tbody");
  document.querySelector("#tabela-anual thead tr").innerHTML = "<th>CID</th><th>SUS</th><th>ANS</th><th>Ticket SUS</th><th>Ticket ANS</th><th>ANS / SUS</th>";
  corpo.replaceChildren();
  linhas.forEach((item) => {
    const susTicket = item.sus_n ? item.sus_valor / item.sus_n : 0;
    const ansTicket = item.ans_n ? item.ans_valor / item.ans_n : 0;
    const tr = document.createElement("tr");
    const textos = [
      item.nome ? `${item.cid} ${item.nome}` : item.cid,
      numero.format(item.sus_n),
      numero.format(item.ans_n),
      reais.format(susTicket),
      reais.format(ansTicket),
      susTicket ? `${(ansTicket / susTicket).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×` : "—",
    ];
    textos.forEach((texto, indice) => {
      const td = document.createElement("td");
      td.textContent = texto;
      if (indice === 0) td.style.textAlign = "left";
      tr.appendChild(td);
    });
    corpo.appendChild(tr);
  });
}

function desenhar() {
  caixaInicio.hidden = modoEl.value === "cid";
  if (modoEl.value === "cid") {
    desenharCid();
    return;
  }
  document.querySelector(".analise h2").textContent = "Total do ano";
  const sigla = estadoEl.value;
  const nome = sus.estados.find((item) => item.sigla === sigla).nome;
  const ticket = modoEl.value === "ticket";
  const susBase = ticket
    ? recorte(custos.series.ticket[sigla].observado, custos.meses, "2023-01", "2025-12")
    : recorte(sus.estados.find((item) => item.sigla === sigla).observado, sus.meses, "2015-01", "2025-12");
  const ansBase = ticket
    ? recorte(ans.valor.series[sigla].ticket, ans.valor.meses, "2023-01", "2025-12")
    : recorte(ans.estados.find((item) => item.sigla === sigla).observado, ans.meses, "2015-01", "2025-12");
  const porMes = new Map(ansBase.eixo.map((mes, indice) => [mes, ansBase.valores[indice]]));
  const eixo = susBase.eixo.filter((mes) => porMes.has(mes) && mes >= inicioEl.value);
  let serieSus = eixo.map((mes) => susBase.valores[susBase.eixo.indexOf(mes)]);
  let serieAns = eixo.map((mes) => porMes.get(mes));
  if (modoEl.value === "indice") {
    const susIndice = indice(susBase.valores, susBase.eixo);
    const ansIndice = indice(ansBase.valores, ansBase.eixo);
    serieSus = susBase.eixo.filter((mes) => mes >= inicioEl.value).map((mes) => susIndice[susBase.eixo.indexOf(mes)]);
    serieAns = ansBase.eixo.filter((mes) => mes >= inicioEl.value).map((mes) => ansIndice[ansBase.eixo.indexOf(mes)]);
  }
  const largura = 1000;
  const altura = 480;
  const margem = { topo: 16, direita: 16, baixo: 52, esquerda: ticket ? 88 : modoEl.value === "indice" ? 56 : 72 };
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
    const rotulo = ticket
      ? reais.format(valor)
      : modoEl.value === "indice"
        ? valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 })
        : numero.format(Math.round(valor));
    grade += `<line x1="${margem.esquerda}" x2="${largura - margem.direita}" y1="${y}" y2="${y}" stroke="#efe8dc"></line>`;
    grade += `<text x="${margem.esquerda - 8}" y="${y + 4}" text-anchor="end" fill="#57534e" font-size="12">${rotulo}</text>`;
  }
  const porAno = eixo.length > 36;
  let datas = "";
  eixo.forEach((mes, i) => {
    const [ano, numeroMes] = mes.split("-");
    const rotulo = porAno ? (numeroMes === "01" ? ano : "") : `${numeroMes}/${ano.slice(2)}`;
    if (!rotulo) return;
    if (!porAno && eixo.length > 18 && i % 2 !== 0) return;
    datas += `<text x="${xDe(i).toFixed(1)}" y="${margem.topo + internoA + 18}" text-anchor="middle" fill="#57534e" font-size="12">${rotulo}</text>`;
  });
  const linha = (serie, cor) => {
    const d = serie.map((valor, i) => `${i === 0 ? "M" : "L"} ${xDe(i).toFixed(1)} ${yDe(valor).toFixed(1)}`).join(" ");
    return `<path d="${d}" fill="none" stroke="${cor}" stroke-width="2.2"></path>`;
  };
  svg.setAttribute("viewBox", `0 0 ${largura} ${altura}`);
  svg.innerHTML = `<rect width="${largura}" height="${altura}" fill="#fffcf7"></rect>${grade}${linha(serieSus, "#1f4e79")}${linha(serieAns, "#c45911")}${datas}`;
  const antes = eixo[0] > inicioEl.value ? ` O pedido era ${nomeMes(inicioEl.value)}, e esta comparação começa em ${nomeMes(eixo[0])}.` : "";
  if (ticket) {
    titulo.textContent = `${nome}. De ${nomeMes(eixo[0])} a ${nomeMes(eixo[eixo.length - 1])}. Azul é o ticket do SUS e laranja é o da ANS, em reais da época.${antes}`;
    resumo.textContent = "O ticket da ANS só existe a partir de janeiro de 2023. Cada ponto é o valor do mês dividido pelas internações daquele mês.";
  } else if (modoEl.value === "indice") {
    titulo.textContent = `${nome}. De ${nomeMes(eixo[0])} a ${nomeMes(eixo[eixo.length - 1])}. 100 é a média mensal de 2015 de cada série. 120 significa 20% acima dessa média.`;
    resumo.textContent = "O formato da curva compara o crescimento. A quantidade de internações do SUS e a da ANS ficam na mesma altura de partida.";
  } else {
    titulo.textContent = `${nome}. De ${nomeMes(eixo[0])} a ${nomeMes(eixo[eixo.length - 1])}. Azul é o SUS e laranja é a ANS, em número de internações.`;
    resumo.textContent = "A comparação usa janeiro de 2015 a dezembro de 2025, o período em que as duas séries existem.";
  }
  legenda.innerHTML = `<span><i class="amostra"></i>SUS</span><span><i class="amostra tft"></i>ANS</span>`;
  escreverTabela(sigla);
}

function escreverTabela(sigla) {
  const corpo = document.querySelector("#tabela-anual tbody");
  document.querySelector("#tabela-anual thead tr").innerHTML = "<th>Ano</th><th>SUS</th><th>ANS</th><th>ANS / SUS</th>";
  const colunas = document.querySelectorAll("#tabela-anual thead th");
  corpo.replaceChildren();
  const ticket = modoEl.value === "ticket";
  colunas[1].textContent = ticket ? "Ticket SUS" : "SUS";
  colunas[2].textContent = ticket ? "Ticket ANS" : "ANS";
  colunas[3].textContent = "ANS / SUS";
  const susEstado = sus.estados.find((item) => item.sigla === sigla);
  const ansEstado = ans.estados.find((item) => item.sigla === sigla);
  const inicio = ticket ? 2023 : 2015;
  for (let ano = inicio; ano <= 2025; ano += 1) {
    let susAno;
    let ansAno;
    let relacao;
    if (ticket) {
      const susValor = somaAno(custos.meses, custos.series.valor[sigla].observado, ano);
      const susQuantidade = somaAno(sus.meses, susEstado.observado, ano);
      const ansValor = somaAno(ans.valor.meses, ans.valor.series[sigla].valor, ano);
      const ansQuantidade = somaAno(ans.meses, ansEstado.observado, ano);
      susAno = susQuantidade ? susValor / susQuantidade : 0;
      ansAno = ansQuantidade ? ansValor / ansQuantidade : 0;
      relacao = susAno ? `${(ansAno / susAno).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×` : "—";
    } else {
      susAno = somaAno(sus.meses, susEstado.observado, ano);
      ansAno = somaAno(ans.meses, ansEstado.observado, ano);
      relacao = pct1(susAno ? ansAno / susAno : 0);
    }
    const textos = ticket
      ? [String(ano), reais.format(susAno), reais.format(ansAno), relacao]
      : [String(ano), numero.format(susAno), numero.format(ansAno), relacao];
    const tr = document.createElement("tr");
    textos.forEach((texto, indice) => {
      const td = document.createElement("td");
      td.textContent = texto;
      if (indice === 0) td.style.textAlign = "left";
      tr.appendChild(td);
    });
    corpo.appendChild(tr);
  }
}

function preparar(susDados, ansDados, custosDados) {
  sus = susDados;
  ans = ansDados;
  custos = custosDados;
  const ordenados = [...sus.estados].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  estadoEl.innerHTML = ordenados.map((uf) => `<option value="${uf.sigla}">${uf.nome}</option>`).join("");
  estadoEl.value = "MG";
  desenhar();
}

Promise.all([
  fetch("dados/previsao.json").then((resposta) => resposta.json()),
  fetch("dados/ans.json").then((resposta) => resposta.json()),
  fetch("dados/custos.json").then((resposta) => resposta.json()),
])
  .then(([susDados, ansDados, custosDados]) => preparar(susDados, ansDados, custosDados))
  .catch(() => {
    resumo.textContent = "Não foi possível ler as duas séries.";
  });

fetch("dados/cid.json")
  .then((resposta) => (resposta.ok ? resposta.json() : null))
  .then((dados) => {
    cid = dados;
    if (modoEl.value === "cid" && sus) desenhar();
  })
  .catch(() => {
    cid = null;
  });

estadoEl.addEventListener("change", desenhar);
inicioEl.addEventListener("change", desenhar);
modoEl.addEventListener("change", desenhar);
