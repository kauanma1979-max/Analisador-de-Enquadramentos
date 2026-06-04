import React, { useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  FileUp,
  ClipboardCopy,
  Check,
  Database,
  ShieldAlert,
  FileText,
  MapPin,
  UserCheck,
  Search,
  Download,
  AlertCircle,
  Info,
  RotateCcw,
  Sparkles,
  ExternalLink,
  Table
} from "lucide-react";
import { Autuacao, RelatorioAnalise } from "./types";
import {
  analisarTextoAIT,
  extrairTextoDePDF,
  getDadosExemploReferencia,
  gerarTextoExplicativoRelatorio,
  formatarPeriodoOuData,
  obterCidadesLimpas,
  obterAgentesLimpos
} from "./utils/pdfParser";

export default function App() {
  const [relatorio, setRelatorio] = useState<RelatorioAnalise | null>(null);
  const [status, setStatus] = useState<{
    loading: boolean;
    error: string | null;
    fileName: string | null;
  }>({
    loading: false,
    error: null,
    fileName: null
  });

  const [copiado, setCopiado] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [filtroPesquisa, setFiltroPesquisa] = useState("");
  const [viewTab, setViewTab] = useState<"dashboard" | "tabela">("dashboard");
  const [pastaTexto, setPastaTexto] = useState("");
  const [mostrarCampoTexto, setMostrarCampoTexto] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Carrega os 36 registros reais do PDF exemplo em 1 clique
  const tratarCarregarExemplo = () => {
    setStatus({
      loading: false,
      error: null,
      fileName: "Relatório_Exemplo_SISTEMA_SIM.pdf"
    });
    const dadosExemplo = getDadosExemploReferencia();
    setRelatorio(dadosExemplo);
  };

  // Reseta o estado da análise
  const tratarReiniciar = () => {
    setRelatorio(null);
    setFiltroPesquisa("");
    setPastaTexto("");
    setStatus({
      loading: false,
      error: null,
      fileName: null
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Processa o arquivo PDF selecionado
  const processarArquivoPDF = async (file: File) => {
    if (!file) return;
    if (file.type !== "application/pdf") {
      setStatus(prev => ({
        ...prev,
        error: "Por favor, envie um arquivo válido no formato PDF (.pdf)."
      }));
      return;
    }

    setStatus({
      loading: true,
      error: null,
      fileName: file.name
    });

    try {
      // Extrai texto do PDF no navegador sem enviar para nenhum servidor
      const textoPdf = await extrairTextoDePDF(file);
      
      // Analisa o texto bruto de forma analítica e determinística
      const relatorioGerado = analisarTextoAIT(textoPdf);

      if (relatorioGerado.totalGeral === 0) {
        throw new Error(
          "Não conseguimos identificar nenhuma autuação (AIT) no formato padrão do Sistema SIM neste arquivo. Certifique-se de carregar um relatório de produção de AIT ou use a nossa colagem de texto alternativo."
        );
      }

      setRelatorio(relatorioGerado);
      setStatus(prev => ({ ...prev, loading: false }));
    } catch (err: any) {
      console.error(err);
      setStatus({
        loading: false,
        error: err.message || "Erro desconhecido ao ler o PDF.",
        fileName: null
      });
    }
  };

  // Lida com o input manual do PDF
  const tratarSelecaoDeArquivo = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processarArquivoPDF(e.target.files[0]);
    }
  };

  // Drag and drop do arquivo PDF
  const lidarComDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const lidarComDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processarArquivoPDF(e.dataTransfer.files[0]);
    }
  };

  // Processa texto colado manualmente
  const processarTextoColado = () => {
    if (!pastaTexto.trim()) {
      setStatus(prev => ({
        ...prev,
        error: "Por favor, cole o texto do relatório antes de analisar."
      }));
      return;
    }

    setStatus({
      loading: true,
      error: null,
      fileName: "Texto_Colado_Manualmente.txt"
    });

    try {
      const relatorioGerado = analisarTextoAIT(pastaTexto);
      if (relatorioGerado.totalGeral === 0) {
        throw new Error(
          "Não foi encontrada nenhuma autuação compatível com o formato do Sistema SIM no texto fornecido. Tente copiar e colar novamente todo o conteúdo do relatório de produção de AIT."
        );
      }
      setRelatorio(relatorioGerado);
      setStatus(prev => ({ ...prev, loading: false }));
    } catch (err: any) {
      setStatus({
        loading: false,
        error: err.message,
        fileName: null
      });
    }
  };

  // Copia o texto explicativo sintetizado para o clipboard do usuário
  const tratarCopiarTextoCompleto = () => {
    if (!relatorio) return;
    const textoCompleto = gerarTextoExplicativoRelatorio(relatorio);
    navigator.clipboard.writeText(textoCompleto);
    setCopiado(true);
    setTimeout(() => {
      setCopiado(false);
    }, 2000);
  };

  // Download do relatório formatado em .txt
  const tratarBaixarRelatorio = () => {
    if (!relatorio) return;
    const textoCompleto = gerarTextoExplicativoRelatorio(relatorio);
    const blob = new Blob([textoCompleto], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Analise_AIT_SIM_${relatorio.orgao || "DETRAN"}_${Date.now()}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Exporta a tabela atual de autuações para CSV
  const tratarExportarCSV = () => {
    if (!relatorio || relatorio.autuacoes.length === 0) return;
    
    // Cabeçalho do CSV
    let csv = "AIT;Placa;Data Infracao;Agente;Codigo Enquadramento;Descricao Enquadramento;Municipio Infracao\n";
    
    // Conteúdo das autuações
    relatorio.autuacoes.forEach((aut) => {
      csv += `"${aut.ait}";"${aut.placa}";"${aut.dataInfracao}";"${aut.agente}";"${aut.codigoEnquadramento}";"${aut.descricaoEnquadramento}";"${aut.municipioInfracao}"\n`;
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: "text/csv;charset=utf-8" }); // com BOM para UTF-8 acentos corretos no Excel
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Planilha_AIT_Exportada_${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Filtra as autuações com base na barra de busca
  const autuacoesFiltradas = relatorio
    ? relatorio.autuacoes.filter(
        aut =>
          aut.ait.toLowerCase().includes(filtroPesquisa.toLowerCase()) ||
          aut.placa.toLowerCase().includes(filtroPesquisa.toLowerCase()) ||
          aut.codigoEnquadramento.toLowerCase().includes(filtroPesquisa.toLowerCase()) ||
          aut.descricaoEnquadramento.toLowerCase().includes(filtroPesquisa.toLowerCase()) ||
          aut.municipioInfracao.toLowerCase().includes(filtroPesquisa.toLowerCase()) ||
          aut.agente.toLowerCase().includes(filtroPesquisa.toLowerCase())
      )
    : [];

  // Define cores de destaque estéticas e coordenadas para cada código de enquadramento
  const mapearCoresEnquadramento = (codigo: string) => {
    switch (codigo) {
      case "7544-1":
        return {
          bg: "bg-red-50",
          border: "border-red-200",
          text: "text-red-700",
          barColor: "bg-red-500"
        };
      case "7633-2":
        return {
          bg: "bg-amber-50",
          border: "border-amber-200",
          text: "text-amber-700",
          barColor: "bg-amber-500"
        };
      case "5185-1":
        return {
          bg: "bg-emerald-50",
          border: "border-emerald-200",
          text: "text-emerald-700",
          barColor: "bg-emerald-500"
        };
      case "6599-2":
        return {
          bg: "bg-indigo-50",
          border: "border-indigo-200",
          text: "text-indigo-700",
          barColor: "bg-indigo-500"
        };
      default:
        return {
          bg: "bg-slate-50",
          border: "border-slate-200",
          text: "text-slate-700",
          barColor: "bg-indigo-600"
        };
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans tracking-normal selection:bg-indigo-100 selection:text-indigo-900 pb-16 antialiased">
      {/* HEADER CORPORATIVO E MODERNO - PROFESSIONAL POLISH */}
      <header className="border-b border-slate-200 bg-white sticky top-0 z-40 backdrop-blur-md bg-opacity-80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded bg-indigo-600 text-white flex items-center justify-center font-display font-bold text-base shadow-sm">
              S
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display font-bold tracking-tight text-lg text-slate-800">
                  Analisador de Enquadramentos PDF
                </span>
                <span className="text-[10px] font-mono uppercase bg-slate-100 text-slate-600 px-2 py-0.5 rounded border border-slate-200 tracking-widest leading-none font-semibold">
                  Versão 2.4.0
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Análise e Contabilidade de Auto de Infração de Trânsito • SISTEMA SIM
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 text-xs bg-slate-100 border border-slate-200 text-slate-600 px-3 py-1.5 rounded-full">
              <span className="block h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Operando localmente offline
            </div>
            
            <a
              href="https://ai.studio/build"
              target="_blank"
              rel="noreferrer referrer"
              className="text-slate-400 hover:text-indigo-600 transition-colors"
              title="Ir para AI Studio"
            >
              <ExternalLink id="ai-studio-link" size={18} />
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        {/* BANNER DE INSTRUÇÕES E PROTEÇÃO À CONVERSAÇÃO SEM IA */}
        <div id="intro-banner" className="mb-8 p-6 bg-slate-900 text-white rounded-xl relative overflow-hidden shadow-sm">
          <div className="absolute right-0 top-0 h-40 w-40 bg-indigo-600 rounded-full filter blur-3xl opacity-30 transform translate-x-10 -translate-y-10"></div>
          <div className="relative z-10 max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-slate-800 text-slate-300 rounded-full text-xs font-medium mb-4 border border-slate-705">
              <Info size={13} className="text-indigo-400" />
              100% de Conformidade com as Diretrizes
            </div>
            <h1 className="text-3xl sm:text-4xl font-display font-semibold tracking-tight mb-2 leading-none text-white">
              Validador de Enquadramentos de Trânsito (AIT)
            </h1>
            <p className="text-slate-300 text-sm leading-relaxed mb-4">
              Realize o upload ou cole o texto dos seus relatórios de produção de autuações do SISTEMA SIM. 
              As contagens e estatísticas dos enquadramentos são geradas através de uma rotina determinística 
              em lote que opera diretamente no navegador, garantindo a sua total privacidade e sem utilizar processamento de IA.
            </p>
            <div className="flex flex-wrap items-center gap-y-2 gap-x-6 text-xs text-slate-400 font-mono">
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-455"></span>
                Garantia de 0% de Alucinação
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-455"></span>
                Conformidade com a LGPD
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-455"></span>
                Dossiês Prontos para Cópia
              </div>
            </div>
          </div>
        </div>

        {/* ÁREA DE IMPORTAÇÃO E UPLOAD */}
        <AnimatePresence mode="wait">
          {!relatorio && (
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              id="upload-area-container"
              className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start align-top"
            >
              {/* ÁREA DROP DE PDF */}
              <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-8 shadow-sm relative">
                <h2 className="text-lg font-display font-semibold text-slate-800 mb-1 flex items-center gap-2">
                  <FileUp size={18} className="text-indigo-600" />
                  Upload de Documento
                </h2>
                <p className="text-slate-500 text-xs mb-6">
                  Selecione ou arraste o arquivo gerado pelo Sistema SIM do DETRAN para fazer a auditoria e contabilidade instantânea.
                </p>

                <div
                  onDragEnter={lidarComDrag}
                  onDragOver={lidarComDrag}
                  onDragLeave={lidarComDrag}
                  onDrop={lidarComDrop}
                  className={`border-2 border-dashed rounded-lg p-12 text-center flex flex-col items-center justify-center transition-all ${
                    dragActive
                      ? "border-indigo-600 bg-indigo-50/50 text-indigo-900"
                      : "border-slate-200 hover:border-slate-400 bg-slate-50 text-slate-500"
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf"
                    onChange={tratarSelecaoDeArquivo}
                    id="pdf-file-picker"
                  />
                  
                  <div className="h-14 w-14 rounded bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 mb-4 shadow-sm group-hover:scale-105 transition-transform">
                    <FileUp size={24} className="text-indigo-600" />
                  </div>

                  <p className="text-sm font-medium text-slate-700 mb-1">
                    Arraste o arquivo ou clique para selecionar
                  </p>
                  <p className="text-xs text-slate-400 mb-6">
                    clique no botão para processar o relatório (.pdf)
                  </p>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center justify-center rounded-md px-4 py-2 text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-all shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                    id="select-file-btn"
                  >
                    Subir PDF
                  </button>
                </div>

                {status.loading && (
                  <div className="absolute inset-0 bg-white/90 backdrop-blur-xs rounded-xl flex flex-col items-center justify-center">
                    <div className="h-10 w-10 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4"></div>
                    <p className="text-sm font-semibold text-slate-800">Processando Relatório SIM...</p>
                    <p className="text-xs text-slate-500 mt-1">Extraindo enquadramentos sem uso de IA</p>
                  </div>
                )}

                {status.error && (
                  <div className="mt-4 p-4 bg-red-50 border border-red-100 rounded-lg flex items-start gap-3">
                    <AlertCircle className="text-red-600 shrink-0 mt-0.5" size={16} />
                    <div>
                      <p className="text-xs font-semibold text-red-900">Falha no Processamento</p>
                      <p className="text-[11px] text-red-600 mt-0.5">{status.error}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* DEMONSTRAÇÃO E COLAGEM COADJUVANTE */}
              <div className="lg:col-span-5 space-y-6">
                {/* ATALHO TEXTAREA COPIAR TEXTO */}
                <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-display font-semibold text-slate-800">
                      Entrada Alternativa por Texto Colado
                    </h3>
                    <button
                      type="button"
                      onClick={() => setMostrarCampoTexto(!mostrarCampoTexto)}
                      className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition-colors"
                    >
                      {mostrarCampoTexto ? "Ocultar" : "Expandir"}
                    </button>
                  </div>
                  <p className="text-slate-500 text-xs mt-1 leading-relaxed">
                    Se o seu PDF for de imagem esculpida ou preferir não carregar o arquivo, cole o texto do relatório abaixo.
                  </p>

                  {mostrarCampoTexto && (
                    <div className="mt-4 space-y-3">
                      <textarea
                        value={pastaTexto}
                        onChange={e => setPastaTexto(e.target.value)}
                        placeholder="Cole o texto bruto aqui (Ex: DETRAN AA51572761 GDS9D48 01/06/2026 13:58 283810075 - André Luiz Dos Santos 7544 - 1 - Falta de escrituracao...)"
                        rows={5}
                        className="w-full text-xs font-mono p-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500 resize-none"
                        id="text-paste-area"
                      ></textarea>
                      <button
                        type="button"
                        onClick={processarTextoColado}
                        className="w-full inline-flex items-center justify-center rounded-md py-2 px-4 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all focus:outline-none border border-slate-200"
                      >
                        Auditar Texto Colado
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* SEÇÃO DO DASHBOARD - SÓ APARECE CASO EXISTA RELATÓRIO PROCESSADO */}
        <AnimatePresence>
          {relatorio && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              id="dashboard-container"
              className="space-y-8"
            >
              {/* HEADER DE RESULTADO */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 bg-white rounded-xl border border-slate-200 shadow-sm">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span className="text-[10px] uppercase font-mono text-emerald-700 tracking-wider font-semibold px-2 py-0.5 bg-emerald-50 rounded border border-emerald-100">
                      Sucesso na Auditoria
                    </span>
                  </div>
                  <h2 className="text-xl font-display font-semibold text-slate-800 mt-2">
                    Análise Consolidada do Relatório do {relatorio.orgao || "DETRAN"}
                  </h2>
                  <p className="text-xs text-slate-755 font-semibold mt-1.5 font-sans flex items-center gap-1.5">
                    <span className="text-indigo-650 h-1.5 w-1.5 rounded-full bg-indigo-600"></span>
                    Agente Autuador: <span className="text-slate-900 font-bold">{obterAgentesLimpos(relatorio)}</span>
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5 font-mono">
                    Data: {formatarPeriodoOuData(relatorio.periodo)} | Data do Relatório: {relatorio.dataEmissao}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={tratarReiniciar}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-750 rounded-md transition-all border border-slate-200 focus:outline-none"
                    id="restart-analysis-btn"
                  >
                    <RotateCcw size={13} />
                    Limpar Dados
                  </button>
                </div>
              </div>

              {/* BENTO GRID DE METRICAS PRINCIPAIS */}
              <div className="flex flex-wrap gap-4 sm:gap-6" id="bento-kpis">
                {/* KPI 1 - TOTAL */}
                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm transition-all hover:shadow-md min-w-[240px] flex-1 sm:flex-none">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total de Autuações</span>
                    <div className="h-8 w-8 rounded bg-indigo-50 text-indigo-700 border border-indigo-100 flex items-center justify-center">
                      <ShieldAlert size={16} />
                    </div>
                  </div>
                  <p className="text-3xl sm:text-4xl font-display font-semibold text-slate-800 mb-1">
                    {relatorio.totalGeral}
                  </p>
                  <p className="text-[10px] text-slate-400 font-mono">Registros de AITs compilados</p>
                </div>

                {/* KPI 2 - CIDADE */}
                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm transition-all hover:shadow-md min-w-[240px] flex-1 sm:flex-none">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Cidade</span>
                    <div className="h-8 w-8 rounded bg-indigo-50 text-indigo-700 border border-indigo-100 flex items-center justify-center">
                      <MapPin size={16} />
                    </div>
                  </div>
                  <p className="text-3xl sm:text-4xl font-display font-semibold text-slate-800 mb-1 leading-tight truncate">
                    {obterCidadesLimpas(relatorio)}
                  </p>
                  <p className="text-[10px] text-slate-400 font-mono">Município das autuações</p>
                </div>

                {/* KPI 3 - AGENTE AUTUADOR / DATA */}
                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm transition-all hover:shadow-md min-w-[240px] flex-1 sm:flex-none">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Agente Autuador e Data</span>
                    <div className="h-8 w-8 rounded bg-indigo-50 text-indigo-700 border border-indigo-100 flex items-center justify-center">
                      <UserCheck size={16} />
                    </div>
                  </div>
                  <p className="text-lg font-display font-bold text-slate-800 mb-1 leading-tight truncate" title={obterAgentesLimpos(relatorio)}>
                    {obterAgentesLimpos(relatorio)}
                  </p>
                  <p className="text-[10px] text-slate-400 font-mono mt-1 pt-1.5 border-t border-slate-100 flex items-center gap-1">
                    <span className="text-slate-500 font-semibold">Data:</span> {formatarPeriodoOuData(relatorio.periodo)}
                  </p>
                </div>
              </div>

              {/* SEÇÃO PRINCIPAL DE CONTABILIDADE E RELATÓRIO DO PROMPT */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                
                {/* COLUNA DA ESQUERDA - LISTA QUANTIFICADA DE ENQUADRAMENTOS COM GRÁFICO BARRA */}
                <div className="lg:col-span-6 bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-6" id="quantification-panel">
                  <div>
                    <h3 className="text-lg font-display font-semibold text-slate-800 flex items-center gap-2">
                      <FileText size={18} className="text-indigo-650" />
                      Contagem Quantitativa
                    </h3>
                    <p className="text-slate-500 text-xs">
                      Distribuição quantitativa absoluta e percentual de cada enquadramento identificado nos dados.
                    </p>
                  </div>

                  <div className="space-y-4">
                    {relatorio.porEnquadramento.map((enq) => {
                      const estiloCor = mapearCoresEnquadramento(enq.codigo);
                      return (
                        <div key={enq.codigo} className="space-y-2 p-3.5 rounded-lg bg-slate-50 border border-slate-100">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded border ${estiloCor.bg} ${estiloCor.border} ${estiloCor.text}`}>
                                  {enq.codigo}
                                </span>
                                <span className="text-slate-700 text-xs font-semibold">
                                  {enq.quantidade} ocorrências
                                </span>
                              </div>
                              <p className="text-xs text-slate-600 font-medium mt-1.5 leading-snug">
                                {enq.descricao}
                              </p>
                            </div>

                            <span className="text-sm font-bold text-slate-800 font-mono shrink-0 py-0.5">
                              {enq.percentual}%
                            </span>
                          </div>

                          {/* Barra de progresso interativa da infração */}
                          <div className="w-full bg-slate-200/60 rounded-full h-1.5 mt-2">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${estiloCor.barColor}`}
                              style={{ width: `${enq.percentual}%` }}
                            ></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>


                </div>

                {/* COLUNA DA DIREITA - SÍNTESE TEXTUAL PARA CÓPIA / RELATÓRIO DE ANÁLISE */}
                <div className="lg:col-span-6 bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-6">
                  <div className="flex items-start justify-between py-1 border-b border-slate-100">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">
                        Relatório de Análise
                      </h3>
                      <p className="text-slate-500 text-xs mt-1">
                        Resumo estatístico de composição das autuações, pronto para uso executivo.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={tratarCopiarTextoCompleto}
                      className="flex items-center gap-2 text-xs font-semibold text-indigo-600 hover:text-indigo-700 px-3 py-1.5 rounded-md hover:bg-indigo-50 transition-colors border border-transparent hover:border-indigo-100"
                      id="copy-report-text-btn"
                      title="Copiar texto final"
                    >
                      {copiado ? <Check size={14} className="text-emerald-600" /> : <ClipboardCopy size={14} />}
                      {copiado ? "Texto Copiado!" : "Copiar Texto Final"}
                    </button>
                  </div>

                  <div className="relative">
                    <pre className="w-full text-xs font-mono p-4 rounded-lg bg-slate-900 text-slate-200 overflow-x-auto whitespace-pre-wrap max-h-96 leading-relaxed border border-slate-850 shadow-inner">
                      {gerarTextoExplicativoRelatorio(relatorio)}
                    </pre>

                    {/* Botão de download (.txt) */}
                    <div className="absolute right-4 bottom-4 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={tratarBaixarRelatorio}
                        className="inline-flex items-center gap-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 text-xs font-semibold shadow-sm transition-all focus:outline-none"
                        id="download-report-txt-btn"
                        title="Baixar em formato .txt"
                      >
                        <Download size={14} />
                        Exportar Relatório (.TXT)
                      </button>
                    </div>
                  </div>
                </div>

              </div>


            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer Bar - PROFESSIONAL POLISH */}
      <footer className="mt-16 px-8 py-4 bg-white border-t border-slate-200 flex justify-between items-center text-[10px] text-slate-400 uppercase tracking-widest font-mono">
        <span>Análise de Padrões Visuais • DocRef-2024-X1</span>
        <span>Status: Sistema Pronto</span>
      </footer>
    </div>
  );
}

