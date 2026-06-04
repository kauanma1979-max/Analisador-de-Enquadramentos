export interface Autuacao {
  id: string; // ID único interno (ou o próprio número do AIT se disponível)
  ait: string; // Auto de Infração de Trânsito (ex: AA51572761)
  placa: string; // Placa do veículo (ex: GDS9D48)
  dataInfracao: string; // Data e hora da infração (ex: 01/06/2026 13:58)
  agente: string; // Nome e/ou matrícula do agente (ex: André Luiz Dos Santos - 283810075)
  codigoEnquadramento: string; // Código do enquadramento (ex: 7544-1)
  descricaoEnquadramento: string; // Descrição literária do enquadramento (ex: Falta de escrituracao livro registro...)
  municipioInfracao: string; // Município (ex: CAMPINAS - SP)
}

export interface EstatisticaEnquadramento {
  codigo: string;
  descricao: string;
  quantidade: number;
  percentual: number;
}

export interface EstatisticaMunicipio {
  nome: string;
  quantidade: number;
  percentual: number;
}

export interface EstatisticaAgente {
  nome: string;
  quantidade: number;
  percentual: number;
}

export interface RelatorioAnalise {
  autuacoes: Autuacao[];
  totalGeral: number;
  porEnquadramento: EstatisticaEnquadramento[];
  porMunicipio: EstatisticaMunicipio[];
  porAgente: EstatisticaAgente[];
  dataEmissao?: string;
  periodo?: string;
  orgao?: string;
}
