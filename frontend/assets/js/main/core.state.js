const AppState = {
  jobId: null,
  currentProcessedKmzData: null,
  antenaGlobal: null,
  lastPivosDataDrawn: [],
  lastBombasDataDrawn: [],
  ciclosGlobais: [],
  repetidoras: [],
  modoEdicaoPivos: false,
  modoLoSPivotAPivot: false,
  modoBuscaLocalRepetidora: false,
  modoDesenhoPivo: false,
  modoDesenhoPivoSetorial: false,
  modoDesenhoPivoPacman: false,
  modoDesenhoIrripump: false,
  modoMoverPivoSemCirculo: false,
  modoExcluirPivo: false,
  pontoRaioTemporario: null,
  distanciasPivosVisiveis: false,
  legendasAtivas: true,
  antenaLegendasAtivas: true,
  clickedCandidateData: null,
  ultimoCliqueFoiSobrePivo: false,
  visadaVisivel: false,
  coordenadaClicada: null,
  marcadorPosicionamento: null,
  backupPosicoesPivos: {},
  historyStack: [],
  losSourcePivot: null,
  losTargetPivot: null,
  pivoAlvoParaLocalRepetidora: null,
  templateSelecionado: "",
  centroPivoTemporario: null,
  isDrawingSector: false,
  selectedPivoNome: null,
  selectedSpecialMarker: null,
  marcadorAntena: null,
  marcadoresPivos: [],
  circulosPivos: [],
  pivotsMap: {},
  contadorRepetidoras: 0,
  idsDisponiveis: [],
  marcadoresLegenda: [],
  marcadoresBombas: [],
  posicoesEditadas: {},
  overlaysVisiveis: [],
  linhasDiagnostico: [],
  marcadoresBloqueio: [],

  setJobId(jobId) {
    this.jobId = jobId;
  },

  reset() {
    this.jobId = null;
    this.currentProcessedKmzData = null;
    this.antenaGlobal = null;
    this.lastPivosDataDrawn = [];
    this.lastBombasDataDrawn = [];
    this.ciclosGlobais = [];
    this.repetidoras = [];
    this.modoEdicaoPivos = false;
    this.modoLoSPivotAPivot = false;
    this.modoBuscaLocalRepetidora = false;
    this.modoDesenhoPivo = false;
    this.modoDesenhoPivoSetorial = false;
    this.modoDesenhoPivoPacman = false;
    this.modoDesenhoIrripump = false;
    this.pontoRaioTemporario = null;
    this.distanciasPivosVisiveis = false;
    this.legendasAtivas = true;
    this.antenaLegendasAtivas = true;
    this.visadaVisivel = false;
    this.clickedCandidateData = null;
    this.ultimoCliqueFoiSobrePivo = false;
    this.coordenadaClicada = null;
    this.marcadorPosicionamento = null;
    this.backupPosicoesPivos = {};
    this.historyStack = [];
    this.losSourcePivot = null;
    this.losTargetPivot = null;
    this.pivoAlvoParaLocalRepetidora = null;
    this.templateSelecionado = "";
    this.centroPivoTemporario = null;
    this.isDrawingSector = false;
    this.selectedPivoNome = null;
    this.selectedSpecialMarker = null;
    this.marcadorAntena = null;
    this.marcadoresPivos = [];
    this.circulosPivos = [];
    this.pivotsMap = {};
    this.contadorRepetidoras = 0;
    this.idsDisponiveis = [];
    this.marcadoresLegenda = [];
    this.marcadoresBombas = [];
    this.posicoesEditadas = {};
    this.overlaysVisiveis = [];
    this.linhasDiagnostico = [];
    this.marcadoresBloqueio = [];
    this.modoMoverPivoSemCirculo = false;
    this.modoExcluirPivo = false;
  }
};
