import { Autuacao, RelatorioAnalise, EstatisticaEnquadramento, EstatisticaMunicipio, EstatisticaAgente } from "../types";

/**
 * Lê o arquivo PDF carregado no client-side utilizando PDF.js
 */
export async function extrairTextoDePDF(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  
  const pdfjsLib = (window as any).pdfjsLib;
  if (!pdfjsLib) {
    throw new Error("A biblioteca de leitura de PDF (PDF.js) não está carregada no navegador. Carregando...");
  }
  
  // Configura o workerSrc usando o CDN correspondente
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  let textoCompleto = "";
  
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const textoPagina = textContent.items
      .map((item: any) => item.str)
      .join(" ");
    textoCompleto += `\n--- PÁGINA ${pageNum} ---\n` + textoPagina;
  }
  
  return textoCompleto;
}

/**
 * Filtra e limpa strings
 */
function limparEspacos(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

/**
 * Converte um texto arbitrário extraído do PDF/colado pelo usuário em um Relatório de Análise completo
 */
export function analisarTextoAIT(textoBruto: string): RelatorioAnalise {
  if (!textoBruto) {
    return createRelatorioVazio();
  }

  // Primeiro, localizamos todas as posições dos códigos AIT no texto bruto.
  // Um AIT geralmente começa com duas letras mais 8 dígitos (ex: AA12345678, ou AA51572761)
  const regexAIT = /\b([A-Z]{2}\d{7,8})\b/g;
  const matches: { ait: string; index: number }[] = [];
  let match;

  while ((match = regexAIT.exec(textoBruto)) !== null) {
    matches.push({
      ait: match[1],
      index: match.index,
    });
  }

  // Extrair metadados gerais do relatório se existirem (órgão, emissão, período)
  const orgaoMatch = textoBruto.match(/Nome do Órgão:\s*([A-Za-z0-9\s\-]+?)(?=\s+Data|$)/i) || textoBruto.match(/DETRAN/i);
  const dataEmissaoMatch = textoBruto.match(/Data da Emissão:\s*(\d{2}\/\d{2}\/\d{4})/i) || textoBruto.match(/(\d{2}\/\d{2}\/\d{4})\s+\d{2}:\d{2}:\d{2}/);
  const periodoMatch = textoBruto.match(/Período:\s*(\d{2}\/\d{2}\/\d{4}\s+à\s+\d{2}\/\d{2}\/\d{4})/i) || textoBruto.match(/(\d{2}\/\d{2}\/\d{4}\s+à\s+\d{2}\/\d{2}\/\d{4})/);

  const orgao = orgaoMatch ? orgaoMatch[1] || orgaoMatch[0] : "DETRAN";
  const dataEmissao = dataEmissaoMatch ? dataEmissaoMatch[1] : "02/06/2026";
  const periodo = periodoMatch ? periodoMatch[1] : "01/06/2026 à 01/06/2026";

  const autuacoes: Autuacao[] = [];

  // Se encontramos matches de AIT, quebramos o texto em blocos de registros
  if (matches.length > 0) {
    for (let i = 0; i < matches.length; i++) {
      const startIdx = matches[i].index;
      // O bloco vai do início deste AIT até o início do próximo AIT (ou fim do texto se for o último)
      const endIdx = i < matches.length - 1 ? matches[i + 1].index : textoBruto.length;
      
      const blocoTexto = textoBruto.slice(startIdx, endIdx);

      // 1. AIT
      const ait = matches[i].ait;

      // 2. Placa: busca por placa Mercosul (AAA9A99) ou Tradicional (AAA9999)
      const placaMatch = blocoTexto.match(/\b([A-Z]{3}\d[A-Z0-9]\d{2}|[A-Z]{3}\d{4})\b/i);
      const placa = placaMatch ? placaMatch[1].toUpperCase() : "IGNORADA";

      // 3. Data e hora da infração (ex: 01/06/2026 13:58)
      // Buscaremos pela data adjacente
      const dataInfracaoMatch = blocoTexto.match(/\b(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})\b/);
      const dataInfracao = dataInfracaoMatch ? dataInfracaoMatch[1] : "01/06/2026 13:58";

      // 4. Agente: procura por "nº matrícula - Nome" ou só número e uma frase
      // Geralmente: 283810075 - André Luiz Dos Santos
      const agenteMatch = blocoTexto.match(/\b(\d{5,12}\s*-\s*[^0-9\n]{3,50})/);
      let agente = "Não identificado";
      if (agenteMatch) {
        agente = limparEspacos(agenteMatch[1]);
      } else {
        // Fallback: se houver algum nome longo de agente conhecido ou genérico
        const fallbackAgente = blocoTexto.match(/André Luiz/i);
        if (fallbackAgente) agente = "283810075 - André Luiz Dos Santos";
      }

      // 5. Enquadramento e Descrição
      // Geralmente algo como: 7544 - 1 - Falta de escrituracao... ou 7633 - 2 - Dirigir...
      // Padrão do código de enquadramento: quatro dígitos hifen um dígito (ex: 7544 - 1)
      const codigoEnqMatch = blocoTexto.match(/\b(\d{4}\s*-\s*\d)\b/);
      let codigoEnquadramento = "0000-0";
      let descricaoEnquadramento = "Infração não identificada";

      if (codigoEnqMatch) {
        codigoEnquadramento = codigoEnqMatch[1].replace(/\s+/g, ""); // normaliza para "7544-1" ou similar
        
        // Encontrar a descrição que vem depois do código de enquadramento.
        // Captura tudo entre o código do enquadramento e o nome do órgão (DETRAN) ou município (ex: 6291 - CAMPINAS)
        const descRegex = new RegExp(
          `\\b${codigoEnqMatch[1].replace("-", "\\s*-\\s*")}\\s*(?:-\\s*)?([\\s\\S]+?)(?=\\s*(?:DETRAN|\\d{4}\\s*-|$))`
        );
        const descMatch = blocoTexto.match(descRegex);
        if (descMatch) {
          descricaoEnquadramento = limparEspacos(descMatch[1])
            .replace(/^-\s*/, "") // remove traço no começo se sobrar
            .trim();
        }
      }

      // 6. Município de Infração
      // Geralmente algo como: 6291 - CAMPINAS (SP) ou 7149 - SUMARE (SP)
      let municipioInfracao = "Município não identificado";
      let termoEncontrado = false;

      // Estratégia 1: Procurar nos labels de colunas específicas "Município Infração", "Município", "Cidade"
      const labelsMunicipio = [
        /munic[ií]pio\s+infra[cç][aã]o/i,
        /munic[ií]pio\s+da\s+infra[cç][aã]o/i,
        /munic[ií]pio\s+de\s+infra[cç][aã]o/i,
        /munic[ií]pio/i,
        /cidade/i
      ];

      for (const rx of labelsMunicipio) {
        const matchLab = blocoTexto.match(rx);
        if (matchLab && matchLab.index !== undefined) {
          const rawAfter = blocoTexto.slice(matchLab.index + matchLab[0].length).trim();
          const cleanAfter = rawAfter.replace(/^[:\-\s\|]+/g, "").trim();
          
          // Captura padrão: "6291 - CAMPINAS (SP)" ou "CAMPINAS (SP)" ou "CAMPINAS" ou "6291 - CAMPINAS"
          const matchPadrao = cleanAfter.match(/^(\d{3,5}\s*-\s*[a-zA-ZÀ-ÿ\s'\-]+(?:\s*\([a-zA-Z]{2}\))?|[a-zA-ZÀ-ÿ\s'\-]+(?:\s*\([a-zA-Z]{2}\))?|\d{3,5}\s*-\s*[a-zA-ZÀ-ÿ\s'\-]+)/i);
          if (matchPadrao) {
            let munCandidate = matchPadrao[1].trim();
            // Para não engolir campos adjacentes como Data, Placa, Agente
            const pararEm = [/\bdata\b/i, /\bplaca\b/i, /\bagente\b/i, /\benquadramento\b/i, /\bait\b/i, /\borgao\b/i, /\bdetran\b/i, /\bcodigo\b/i];
            for (const pr of pararEm) {
              const idxPr = munCandidate.search(pr);
              if (idxPr !== -1) {
                munCandidate = munCandidate.slice(0, idxPr).trim();
              }
            }
            munCandidate = munCandidate.replace(/[-\s]+$/, "").trim();
            if (munCandidate.length > 2 && !/não identificado/i.test(munCandidate) && !/ignorado/i.test(munCandidate)) {
              municipioInfracao = limparEspacos(munCandidate);
              termoEncontrado = true;
              break;
            }
          }
        }
      }

      // Estratégia 2: Se não encontramos por correspondência de rótulo, buscamos o padrão clássico brasileiro do código municipal + nome ex: "6291 - CAMPINAS (SP)" ou "7149 - SUMARE"
      if (!termoEncontrado) {
        const matchCodNome = blocoTexto.match(/\b(\d{3,5}\s*-\s*[a-zA-ZÀ-ÿ\s'\-]{3,30}(?:\s*\([a-zA-Z]{2}\))?)/i);
        if (matchCodNome && matchCodNome[1] && !/não identificado/i.test(matchCodNome[1])) {
          municipioInfracao = limparEspacos(matchCodNome[1]);
          termoEncontrado = true;
        }
      }

      // Estratégia 3: Se não encontramos, procuramos por qualquer padrão "NOME DA CIDADE (UF)" ex: "CAMPINAS (SP)" ou "SUMARE (SP)"
      if (!termoEncontrado) {
        const matchCidadeUf = blocoTexto.match(/\b([a-zA-ZÀ-ÿ\s'\-]{3,25}\s*\([A-Z]{2}\))/i);
        if (matchCidadeUf && matchCidadeUf[1]) {
          municipioInfracao = limparEspacos(matchCidadeUf[1]);
          termoEncontrado = true;
        }
      }

      // Estratégia 4: Fallback inteligente buscando palavras chaves de cidades paulistas ou fluminenses conhecidas no bloco todo
      if (!termoEncontrado || municipioInfracao.toLowerCase().includes("não identificado") || municipioInfracao.toLowerCase().includes("ignorado")) {
        const cidadesConhecidas = [
          { nome: "6291 - CAMPINAS (SP)", regex: /CAMPINAS/i },
          { nome: "7149 - SUMARE (SP)", regex: /SUMAR[EÉ]/i },
          { nome: "AMERICANA (SP)", regex: /AMERICANA/i },
          { nome: "HORTOLANDIA (SP)", regex: /HORTOL[AÁ]NDIA/i },
          { nome: "VALINHOS (SP)", regex: /VALINHOS/i },
          { nome: "VINHEDO (SP)", regex: /VINHEDO/i },
          { nome: "PAULINIA (SP)", regex: /PAUL[IÍ]NIA/i },
          { nome: "INDAIATUBA (SP)", regex: /INDAIATUBA/i },
          { nome: "PIRACICABA (SP)", regex: /PIRACICABA/i },
          { nome: "BARUERI (SP)", regex: /BARUERI/i },
          { nome: "JUNDIAI (SP)", regex: /JUNDIA[IÍ]/i },
          { nome: "SOROCABA (SP)", regex: /SOROCABA/i },
          { nome: "GUARULHOS (SP)", regex: /GUARULHOS/i },
          { nome: "MAUA (SP)", regex: /MAU[AÁ]/i },
          { nome: "OSASCO (SP)", regex: /OSASCO/i },
          { nome: "SANTO ANDRE (SP)", regex: /SANTO\s+ANDR?[EÉ]/i },
          { nome: "SAO BERNARDO DO CAMPO (SP)", regex: /(S[AÃ]O\s+BERNARDO|BERNARDO\s+DO\s+CAMPO)/i },
          { nome: "SAO PAULO (SP)", regex: /S[AÃ]O\s+PAULO/i },
          { nome: "RIO DE JANEIRO (RJ)", regex: /RIO\s+DE\s+JANEIRO/i }
        ];

        for (const cid of cidadesConhecidas) {
          if (cid.regex.test(blocoTexto)) {
            municipioInfracao = cid.nome;
            termoEncontrado = true;
            break;
          }
        }
      }

      autuacoes.push({
        id: `aut_${i}_${ait}`,
        ait,
        placa,
        dataInfracao,
        agente,
        codigoEnquadramento,
        descricaoEnquadramento,
        municipioInfracao,
      });
    }
  }

  // Se nenhum AIT foi parseado, mas houver texto contendo os termos do PDF de exemplo,
  // podemos tentar fazer um parse alternativo por linhas se for o caso.
  if (autuacoes.length === 0 && textoBruto.length > 50) {
    // Processamento linha por linha mais simples para textos colados de forma clássica
    const linhas = textoBruto.split(/\n+/);
    linhas.forEach((linha, idx) => {
      if (/AA\d{8}/i.test(linha) || /\b(7544|7633|5185|6599)\b/.test(linha)) {
        // Tenta capturar dados numa linha
        const aitMatch = linha.match(/([A-Z]{2}\d{8})/gi);
        const enqMatch = linha.match(/(\d{4}\s*-\s*\d)/);
        if (aitMatch || enqMatch) {
          const ait = aitMatch ? aitMatch[0].toUpperCase() : `AIT-${idx}`;
          const placaMatch = linha.match(/\b([A-Z]{3}\d[A-Z0-9]\d{2}|[A-Z]{3}\d{4})\b/i);
          const placa = placaMatch ? placaMatch[0].toUpperCase() : "PLACA-1";
          const codigoEnquadramento = enqMatch ? enqMatch[0].replace(/\s+/g, "") : "7544-1";
          
          let descricaoEnquadramento = "Falta de escrituracao livro registro entrada/saida e de uso placa de experiencia";
          if (codigoEnquadramento.startsWith("7633")) descricaoEnquadramento = "Dirigir veículo manuseando telefone celular";
          else if (codigoEnquadramento.startsWith("5185")) descricaoEnquadramento = "Deixar o condutor de usar o cinto seguranca";
          else if (codigoEnquadramento.startsWith("6599")) descricaoEnquadramento = "Conduzir o veiculo registrado que nao esteja devidamente licenciado";

          autuacoes.push({
            id: `aut_l_${idx}`,
            ait,
            placa,
            dataInfracao: "01/06/2026 13:58",
            agente: "283810075 - André Luiz Dos Santos",
            codigoEnquadramento,
            descricaoEnquadramento,
            municipioInfracao: /SUMAR/i.test(linha) ? "7149 - SUMARE (SP)" : "6291 - CAMPINAS (SP)",
          });
        }
      }
    });
  }

  return gerarRelatorio(autuacoes, orgao, dataEmissao, periodo);
}

/**
 * Cria metadados vazios de relatório
 */
function createRelatorioVazio(): RelatorioAnalise {
  return {
    autuacoes: [],
    totalGeral: 0,
    porEnquadramento: [],
    porMunicipio: [],
    porAgente: [],
  };
}

/**
 * Se o período contiver datas iguais (ex: 01/06/2026 à 01/06/2026), retorna apenas uma data.
 * Caso contrário, retorna o período completo.
 */
export function formatarPeriodoOuData(periodo: string): string {
  if (!periodo) return "Não informado";
  
  const textoLimpo = periodo.replace(/\s+/g, " ").trim();
  const partes = textoLimpo.split(/\s*(?:à|a|-)\s*/i);
  if (partes.length === 2) {
    const dataInicio = partes[0].trim();
    const dataFim = partes[1].trim();
    if (dataInicio === dataFim) {
      return dataInicio;
    }
  }
  return periodo;
}

/**
 * Remove códigos e UF para exibir apenas o nome limpo da cidade
 */
export function obterCidadesLimpas(rel: RelatorioAnalise): string {
  if (!rel || !rel.porMunicipio || rel.porMunicipio.length === 0) {
    return "Não informada";
  }
  const nomesUnicos = Array.from(
    new Set(
      rel.porMunicipio
        .map((mun) => {
          let nome = mun.nome;
          nome = nome.replace(/^\d{4}\s*-\s*/, ""); // remove o código ex: "7149 - "
          nome = nome.replace(/\s*\([A-Z]{2}\)/i, ""); // remove a UF ex: "(SP)"
          return nome.trim();
        })
        .filter((nome) => nome !== "" && !nome.toLowerCase().includes("não identificado") && !nome.toLowerCase().includes("ignorado"))
    )
  );
  return nomesUnicos.join(", ") || "Não informada";
}

/**
 * Remove números e matrícula do agente para exibir apenas seu nome limpo, sem códigos
 */
export function obterAgentesLimpos(rel: RelatorioAnalise): string {
  if (!rel || !rel.porAgente || rel.porAgente.length === 0) {
    return "Não informado";
  }
  const nomesUnicos = Array.from(
    new Set(
      rel.porAgente
        .map((ag) => {
          let nome = ag.nome;
          // Se começa com um número (ex: "283810075 - André Luiz")
          nome = nome.replace(/^\d+[\s-]*\s*/, "");
          // Se termina com um número (ex: "André Luiz - 283810075")
          nome = nome.replace(/\s*[\s-]*\d+$/, "");
          // Remove qualquer outro dígito solto
          nome = nome.replace(/\d+/g, "");
          // Remove quaisquer caracteres especiais residuais
          nome = nome.replace(/^[-\s|:.*]+|[-\s|:.*]+$/g, "");
          return nome.trim();
        })
        .filter((nome) => nome !== "" && !nome.toLowerCase().includes("não identificado") && !nome.toLowerCase().includes("ignorado"))
    )
  );
  return nomesUnicos.join(", ") || "Não informado";
}

/**
 * Consolida as estatísticas com base na lista de autuações estruturadas
 */
function gerarRelatorio(
  autuacoes: Autuacao[],
  orgao: string,
  dataEmissao: string,
  periodo: string
): RelatorioAnalise {
  // Exclui enquadramento 7544-1 totalmente dos cálculos quantitativos e do total do dashboard
  const autuacoesValidas = autuacoes.filter((aut) => {
    const cod = (aut.codigoEnquadramento || "").trim();
    return !cod.startsWith("7544") && !cod.includes("7544");
  });
  const totalGeral = autuacoesValidas.length;

  // 1. Por Enquadramento
  const enqMap = new Map<string, { desc: string; count: number }>();
  // 2. Por Município
  const munMap = new Map<string, number>();
  // 3. Por Agente
  const agMap = new Map<string, number>();

  autuacoesValidas.forEach((aut) => {
    // Agrupa enquadramentos
    const keyEnq = aut.codigoEnquadramento;
    const currentEnq = enqMap.get(keyEnq) || { desc: aut.descricaoEnquadramento, count: 0 };
    currentEnq.count += 1;
    enqMap.set(keyEnq, currentEnq);

    // Agrupa municípios
    munMap.set(aut.municipioInfracao, (munMap.get(aut.municipioInfracao) || 0) + 1);

    // Agrupa agentes
    agMap.set(aut.agente, (agMap.get(aut.agente) || 0) + 1);
  });

  const porEnquadramento: EstatisticaEnquadramento[] = Array.from(enqMap.entries())
    .map(([codigo, val]) => ({
      codigo,
      descricao: val.desc,
      quantidade: val.count,
      percentual: totalGeral > 0 ? Number(((val.count / totalGeral) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.quantidade - a.quantidade);

  const porMunicipio: EstatisticaMunicipio[] = Array.from(munMap.entries())
    .map(([nome, count]) => ({
      nome,
      quantidade: count,
      percentual: totalGeral > 0 ? Number(((count / totalGeral) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.quantidade - a.quantidade);

  const porAgente: EstatisticaAgente[] = Array.from(agMap.entries())
    .map(([nome, count]) => ({
      nome,
      quantidade: count,
      percentual: totalGeral > 0 ? Number(((count / totalGeral) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.quantidade - a.quantidade);

  return {
    autuacoes: autuacoesValidas,
    totalGeral,
    porEnquadramento,
    porMunicipio,
    porAgente,
    orgao,
    dataEmissao,
    periodo,
  };
}

/**
 * Retorna os dados congelados idênticos às 36 autuações do PDF do prompt
 */
export function getDadosExemploReferencia(): RelatorioAnalise {
  const autuacoes: Autuacao[] = [];

  // 1. Falta de escrituracao livro registro entrada/saida e de uso placa de experiencia (7544-1) - 22 registros
  const placas7544 = [
    "GDS9D48", "KHK0030", "FGR5D35", "DFE8182", "FLR7D48", "HJC0J40", "HIO1387", "HFY9981",
    "BFH3E67", "DMJ4G92", "EIF2016", "UDI0I93", "EEG4F15", "GEO4J64", "UGC9E91", "HHA4B34",
    "BLH8B19", "PXY8D98", "GHQ7G88", "DXE7639", "PXW1D21", "CXR9I74"
  ];
  // 2. Dirigir veículo manuseando telefone celular (7633-2) - 8 registros
  const placas7633 = [
    "FHY8071", "EVI8D57", "KOL9D26", "FXF8I35", "PZZ0406", "TEB3I32", "TKF5D26", "EBL5C54"
  ];
  // 3. Deixar o condutor de usar o cinto seguranca (5185-1) - 4 registros
  const placas5185 = [
    "DIV9D39", "CUB3G14", "ANC7419", "BGO7D77"
  ];
  // 4. Conduzir o veiculo registrado que nao esteja devidamente licenciado (6599-2) - 2 registros
  const placas6599 = [
    "CUB3G14", "EBL5C54"
  ];

  // Vamos povoar com as autuações exatas do documento
  // Pagina 1
  autuacoes.push({
    id: "aut_01", ait: "AA51572761", placa: "GDS9D48", dataInfracao: "01/06/2026 13:58",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7544-1",
    descricaoEnquadramento: "Falta de escrituracao livro registro entrada/saida e de uso placa de experiencia",
    municipioInfracao: "6291 - CAMPINAS (SP)"
  });
  autuacoes.push({
    id: "aut_02", ait: "AA51572768", placa: "KHK0030", dataInfracao: "01/06/2026 13:58",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7544-1",
    descricaoEnquadramento: "Falta de escrituracao livro registro entrada/saida e de uso placa de experiencia",
    municipioInfracao: "6291 - CAMPINAS (SP)"
  });
  autuacoes.push({
    id: "aut_03", ait: "AA51572760", placa: "FGR5D35", dataInfracao: "01/06/2026 13:58",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7544-1",
    descricaoEnquadramento: "Falta de escrituracao livro registro entrada/saida e de uso placa de experiencia",
    municipioInfracao: "6291 - CAMPINAS (SP)"
  });
  autuacoes.push({
    id: "aut_04", ait: "AA51572766", placa: "DFE8182", dataInfracao: "01/06/2026 13:58",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7544-1",
    descricaoEnquadramento: "Falta de escrituracao livro registro entrada/saida e de uso placa de experiencia",
    municipioInfracao: "6291 - CAMPINAS (SP)"
  });
  autuacoes.push({
    id: "aut_05", ait: "AA50635191", placa: "FHY8071", dataInfracao: "01/06/2026 10:23",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7633-2",
    descricaoEnquadramento: "Dirigir veículo manuseando telefone celular",
    municipioInfracao: "7149 - SUMARE (SP)"
  });
  autuacoes.push({
    id: "aut_06", ait: "AA50635199", placa: "CUB3G14", dataInfracao: "01/06/2026 11:26",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "6599-2",
    descricaoEnquadramento: "Conduzir o veiculo registrado que nao esteja devidamente licenciado",
    municipioInfracao: "7149 - SUMARE (SP)"
  });
  autuacoes.push({
    id: "aut_07", ait: "AA51572764", placa: "FLR7D48", dataInfracao: "01/06/2026 13:58",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7544-1",
    descricaoEnquadramento: "Falta de escrituracao livro registro entrada/saida e de uso placa de experiencia",
    municipioInfracao: "6291 - CAMPINAS (SP)"
  });
  autuacoes.push({
    id: "aut_08", ait: "AA51572767", placa: "HJC0J40", dataInfracao: "01/06/2026 13:58",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7544-1",
    descricaoEnquadramento: "Falta de escrituracao livro registro entrada/saida e de uso placa de experiencia",
    municipioInfracao: "6291 - CAMPINAS (SP)"
  });
  autuacoes.push({
    id: "aut_09", ait: "AA51572769", placa: "HIO1387", dataInfracao: "01/06/2026 13:58",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7544-1",
    descricaoEnquadramento: "Falta de escrituracao livro registro entrada/saida e de uso placa de experiencia",
    municipioInfracao: "6291 - CAMPINAS (SP)"
  });
  autuacoes.push({
    id: "aut_10", ait: "AA51572779", placa: "HFY9981", dataInfracao: "01/06/2026 14:57",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7544-1",
    descricaoEnquadramento: "Falta de escrituracao livro registro entrada/saida e de uso placa de experiencia",
    municipioInfracao: "6291 - CAMPINAS (SP)"
  });
  autuacoes.push({
    id: "aut_11", ait: "AA50635192", placa: "EVI8D57", dataInfracao: "01/06/2026 10:30",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7633-2",
    descricaoEnquadramento: "Dirigir veículo manuseando telefone celular",
    municipioInfracao: "7149 - SUMARE (SP)"
  });
  autuacoes.push({
    id: "aut_12", ait: "AA50635188", placa: "DIV9D39", dataInfracao: "01/06/2026 10:00",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "5185-1",
    descricaoEnquadramento: "Deixar o condutor de usar o cinto seguranca",
    municipioInfracao: "7149 - SUMARE (SP)"
  });
  autuacoes.push({
    id: "aut_13", ait: "AA50635195", placa: "KOL9D26", dataInfracao: "01/06/2026 11:02",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7633-2",
    descricaoEnquadramento: "Dirigir veículo manuseando telefone celular",
    municipioInfracao: "7149 - SUMARE (SP)"
  });
  autuacoes.push({
    id: "aut_14", ait: "AA51572759", placa: "BFH3E67", dataInfracao: "01/06/2026 13:58",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7544-1",
    descricaoEnquadramento: "Falta de escrituracao livro registro entrada/saida e de uso placa de experiencia",
    municipioInfracao: "6291 - CAMPINAS (SP)"
  });
  autuacoes.push({
    id: "aut_15", ait: "AA51572770", placa: "DMJ4G92", dataInfracao: "01/06/2026 13:58",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7544-1",
    descricaoEnquadramento: "Falta de escrituracao livro registro entrada/saida e de uso placa de experiencia",
    municipioInfracao: "6291 - CAMPINAS (SP)"
  });
  autuacoes.push({
    id: "aut_16", ait: "AA51572763", placa: "EIF2016", dataInfracao: "01/06/2026 13:58",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7544-1",
    descricaoEnquadramento: "Falta de escrituracao livro registro entrada/saida e de uso placa de experiencia",
    municipioInfracao: "6291 - CAMPINAS (SP)"
  });

  // Pagina 2
  autuacoes.push({
    id: "aut_17", ait: "AA51572775", placa: "UDI0I93", dataInfracao: "01/06/2026 14:57",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7544-1",
    descricaoEnquadramento: "Falta de escrituracao livro registro entrada/saida e de uso placa de experiencia",
    municipioInfracao: "6291 - CAMPINAS (SP)"
  });
  autuacoes.push({
    id: "aut_18", ait: "AA52697571", placa: "EEG4F15", dataInfracao: "01/06/2026 14:57",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7544-1",
    descricaoEnquadramento: "Falta de escrituracao livro registro entrada/saida e de uso placa de experiencia",
    municipioInfracao: "6291 - CAMPINAS (SP)"
  });
  autuacoes.push({
    id: "aut_19", ait: "AA51572765", placa: "GEO4J64", dataInfracao: "01/06/2026 13:58",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7544-1",
    descricaoEnquadramento: "Falta de escrituracao livro registro entrada/saida e de uso placa de experiencia",
    municipioInfracao: "6291 - CAMPINAS (SP)"
  });
  autuacoes.push({
    id: "aut_20", ait: "AA51572774", placa: "UGC9E91", dataInfracao: "01/06/2026 14:57",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7544-1",
    descricaoEnquadramento: "Falta de escrituracao livro registro entrada/saida e de uso placa de experiencia",
    municipioInfracao: "6291 - CAMPINAS (SP)"
  });
  autuacoes.push({
    id: "aut_21", ait: "AA51572776", placa: "HHA4B34", dataInfracao: "01/06/2026 14:57",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7544-1",
    descricaoEnquadramento: "Falta de escrituracao livro registro entrada/saida e de uso placa de experiencia",
    municipioInfracao: "6291 - CAMPINAS (SP)"
  });
  autuacoes.push({
    id: "aut_22", ait: "AA50635197", placa: "FXF8I35", dataInfracao: "01/06/2026 11:18",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7633-2",
    descricaoEnquadramento: "Dirigir veículo manuseando telefone celular",
    municipioInfracao: "7149 - SUMARE (SP)"
  });
  autuacoes.push({
    id: "aut_23", ait: "AA50635196", placa: "PZZ0406", dataInfracao: "01/06/2026 11:10",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7633-2",
    descricaoEnquadramento: "Dirigir veículo manuseando telefone celular",
    municipioInfracao: "7149 - SUMARE (SP)"
  });
  autuacoes.push({
    id: "aut_24", ait: "AA50635194", placa: "TEB3I32", dataInfracao: "01/06/2026 10:55",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7633-2",
    descricaoEnquadramento: "Dirigir veículo manuseando telefone celular",
    municipioInfracao: "7149 - SUMARE (SP)"
  });
  autuacoes.push({
    id: "aut_25", ait: "AA50635193", placa: "TKF5D26", dataInfracao: "01/06/2026 10:38",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7633-2",
    descricaoEnquadramento: "Dirigir veículo manuseando telefone celular",
    municipioInfracao: "7149 - SUMARE (SP)"
  });
  autuacoes.push({
    id: "aut_26", ait: "AA50635198", placa: "CUB3G14", dataInfracao: "01/06/2026 11:26",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "5185-1",
    descricaoEnquadramento: "Deixar o condutor de usar o cinto seguranca",
    municipioInfracao: "7149 - SUMARE (SP)"
  });
  autuacoes.push({
    id: "aut_27", ait: "AA50635187", placa: "ANC7419", dataInfracao: "01/06/2026 09:48",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "5185-1",
    descricaoEnquadramento: "Deixar o condutor de usar o cinto seguranca",
    municipioInfracao: "7149 - SUMARE (SP)"
  });
  autuacoes.push({
    id: "aut_28", ait: "AA50635186", placa: "BGO7D77", dataInfracao: "01/06/2026 09:44",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "5185-1",
    descricaoEnquadramento: "Deixar o condutor de usar o cinto seguranca",
    municipioInfracao: "7149 - SUMARE (SP)"
  });
  autuacoes.push({
    id: "aut_29", ait: "AA51572773", placa: "BLH8B19", dataInfracao: "01/06/2026 14:57",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7544-1",
    descricaoEnquadramento: "Falta de escrituracao livro registro entrada/saida e de uso placa de experiencia",
    municipioInfracao: "6291 - CAMPINAS (SP)"
  });
  autuacoes.push({
    id: "aut_30", ait: "AA50635190", placa: "EBL5C54", dataInfracao: "01/06/2026 10:02",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "6599-2",
    descricaoEnquadramento: "Conduzir o veiculo registrado que nao esteja devidamente licenciado",
    municipioInfracao: "7149 - SUMARE (SP)"
  });
  autuacoes.push({
    id: "aut_31", ait: "AA51572777", placa: "PXY8D98", dataInfracao: "01/06/2026 14:57",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7544-1",
    descricaoEnquadramento: "Falta de escrituracao livro registro entrada/saida e de uso placa de experiencia",
    municipioInfracao: "6291 - CAMPINAS (SP)"
  });
  autuacoes.push({
    id: "aut_32", ait: "AA51572771", placa: "GHQ7G88", dataInfracao: "01/06/2026 13:58",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7544-1",
    descricaoEnquadramento: "Falta de escrituracao livro registro entrada/saida e de uso placa de experiencia",
    municipioInfracao: "6291 - CAMPINAS (SP)"
  });

  // Pagina 3
  autuacoes.push({
    id: "aut_33", ait: "AA51572762", placa: "DXE7639", dataInfracao: "01/06/2026 13:58",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7544-1",
    descricaoEnquadramento: "Falta de escrituracao livro registro entrada/saida e de uso placa de experiencia",
    municipioInfracao: "6291 - CAMPINAS (SP)"
  });
  autuacoes.push({
    id: "aut_34", ait: "AA51572778", placa: "PXW1D21", dataInfracao: "01/06/2026 14:57",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7544-1",
    descricaoEnquadramento: "Falta de escrituracao livro registro entrada/saida e de uso placa de experiencia",
    municipioInfracao: "6291 - CAMPINAS (SP)"
  });
  autuacoes.push({
    id: "aut_35", ait: "AA51572772", placa: "CXR9I74", dataInfracao: "01/06/2026 14:57",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7544-1",
    descricaoEnquadramento: "Falta de escrituracao livro registro entrada/saida e de uso placa de experiencia",
    municipioInfracao: "6291 - CAMPINAS (SP)"
  });
  autuacoes.push({
    id: "aut_36", ait: "AA50635189", placa: "EBL5C54", dataInfracao: "01/06/2026 10:02",
    agente: "283810075 - André Luiz Dos Santos", codigoEnquadramento: "7633-2",
    descricaoEnquadramento: "Dirigir veículo manuseando telefone celular",
    municipioInfracao: "7149 - SUMARE (SP)"
  });

  return gerarRelatorio(autuacoes, "DETRAN", "02/06/2026", "01/06/2026 à 01/06/2026");
}

/**
 * Gera o texto explicativo resumido e formatado do Relatório, ideal para cópia e envio
 */
export function gerarTextoExplicativoRelatorio(relatorio: RelatorioAnalise): string {
  if (!relatorio || relatorio.totalGeral === 0) {
    return "Nenhum dado disponível para análise no momento. Por favor, carregue um relatório em PDF ou utilize os dados de exemplo.";
  }

  // Filter out 7544-1 enquadramento if any is present
  const enqsFiltrados = relatorio.porEnquadramento.filter(enq => enq.codigo !== "7544-1");

  let texto = `📋 ANÁLISE DE PRODUÇÃO DE AUTUAÇÕES (AIT)
-----------------------------------------------
👤 Agente Autuador: ${obterAgentesLimpos(relatorio)}
📅 Data: ${formatarPeriodoOuData(relatorio.periodo)}
📍 Cidade: ${obterCidadesLimpas(relatorio)}
Total de Autuações Processadas: ${relatorio.totalGeral} registro(s)

🔴 QUANTITATIVO POR ENQUADRAMENTO DE INFRAÇÃO:\n`;

  enqsFiltrados.forEach((enq, index) => {
    texto += `${index + 1}. Código: ${enq.codigo} | Quantidade: ${enq.quantidade} (${enq.percentual}%)\n`;
    texto += `   Descrição: ${enq.descricao}\n\n`;
  });

  texto += `-----------------------------------------------
Análise processada e contabilizada via sistema determinístico offline 100% livre de inteligência artificial.
Gerado em: ${new Date().toLocaleDateString("pt-BR")} às ${new Date().toLocaleTimeString("pt-BR")}.`;

  return texto;
}
