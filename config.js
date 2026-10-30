// Cidade Sem Fim 1.4.1 — TEXTURAS E ESCALAS EDITÁVEIS
// Aponte para arquivos dentro de texturas/ (por exemplo: "texturas/asfalto.jpg").
// Use "" para manter a cor procedural padrão, sem precisar de nenhum arquivo.
// repetirX / repetirY: quantidade de vezes que a imagem aparece em cada direção
// da superfície (UV horizontal / vertical). 1 = imagem única; 4 = quatro repetições.
// Aceita números inteiros ou decimais positivos (ex.: 2, 4, 8 ou 0.5).
// As repetições são aplicadas por objeto/face; superfícies de tamanhos diferentes
// compartilham a configuração do material. O céu funciona melhor em 1 x 1.
// Importante: não aplique imagens aos veículos. Eles mantêm os materiais originais.

// Céu panorâmico (2:1)
export var txdCeu = "texturas/skybox_1.jpg";
export var repetirXCeu = 2;
export var repetirYCeu = 3;

// Solo e florestas
export var txdGrama = "texturas/grama_1.jpg";
export var repetirXGrama = 10;
export var repetirYGrama = 10;

// Jardins e praças
export var txdGramado = "texturas/grama_3.jpg";
export var repetirXGramado = 6;
export var repetirYGramado = 6;

// Ruas
export var txdAsfalto = "texturas/asfalto.jpg";
export var repetirXAsfalto = 4;
export var repetirYAsfalto = 4;

// Estradas rurais
export var txdEstradaTerra = "texturas/terra.jpg";
export var repetirXEstradaTerra = 7;
export var repetirYEstradaTerra = 7;

// Calçadas
export var txdCalcada = "texturas/lajota_9.jpg";
export var repetirXCalcada = 10;
export var repetirYCalcada = 10;

// Estacionamentos
export var txdEstacionamento = "texturas/concreto.jpg";
export var repetirXEstacionamento = 4;
export var repetirYEstacionamento = 4;

// Troncos de árvores
export var txdTroncoArvore = "texturas/arvore_1.jpg";
export var repetirXTroncoArvore = 2;
export var repetirYTroncoArvore = 3;

// Copas das árvores
export var txdCopaArvore = "texturas/planta_14.png";
export var repetirXCopaArvore = 2;
export var repetirYCopaArvore = 2;

// Pedras
export var txdPedra = "texturas/pedra.jpg";
export var repetirXPedra = 2;
export var repetirYPedra = 2;

// Fachadas das casas
export var txdParedeCasa = "texturas/concreto.jpg";
export var repetirXParedeCasa = 3;
export var repetirYParedeCasa = 2;

// Fachadas dos prédios
export var txdParedePredio = "texturas/lajota_8.jpg";
export var repetirXParedePredio = 5;
export var repetirYParedePredio = 9;

// Fachadas das lojas
export var txdParedeLoja = "texturas/tijolo_4.jpg";
export var repetirXParedeLoja = 3;
export var repetirYParedeLoja = 2;

// Portas das casas
export var txdPortaCasa = "texturas/porta_11.jpg";
export var repetirXPortaCasa = 1;
export var repetirYPortaCasa = 1;

// Janelas das casas
export var txdJanelaCasa = "texturas/janela_1.png";
export var repetirXJanelaCasa = 1;
export var repetirYJanelaCasa = 1;

// Janelas dos prédios
export var txdJanelaPredio = "texturas/janela_2.jpg";
export var repetirXJanelaPredio = 1;
export var repetirYJanelaPredio = 1;

// Janelas acesas
export var txdJanelaIluminada = "texturas/janela_2.jpg";
export var repetirXJanelaIluminada = 1;
export var repetirYJanelaIluminada = 1;

// Telhados
export var txdTelhado = "texturas/telhado.jpg";
export var repetirXTelhado = 3;
export var repetirYTelhado = 3;

// Postes de iluminação
export var txdPoste = "";
export var repetirXPoste = 1;
export var repetirYPoste = 3;

// Bancos
export var txdBanco = "texturas/madeira_26.jpg";
export var repetirXBanco = 2;
export var repetirYBanco = 2;

// Sinalizações pintadas na rua
export var txdFaixaRua = "";
export var repetirXFaixaRua = 1;
export var repetirYFaixaRua = 1;

// Água
export var txdAgua = "texturas/agua.jpg";
export var repetirXAgua = 6;
export var repetirYAgua = 6;

// Velocidades (mesma lógica da 1.4)
export var velocidadeCarros = 0.72; // 1.0 = velocidade original do trânsito
export var velocidadeMaximaJogador = 19; // velocidade máxima do carro dirigido

// SISTEMA DE ENTREGAS (versão 1.5)
// 100 unidades do mapa equivalem a ~100 metros do jogo.
export var valorBaseEntrega = 5; // valor fixo mínimo em reais
export var valorPor100Unidades = 7.5; // adicional por 100 unidades de distância

// Controle opcional do brilho de uma imagem personalizada do céu à noite.
// 0.12 = céu bem escuro; 0.25 = mais claro; 1 = sem escurecimento.
// Só é usado quando txdCeu aponta para um arquivo de imagem.
export var brilhoCeuNoturno = 0.01;

// Escala do minimapa: maior = mapa mais aproximado do personagem.
export var zoomMiniMapa = 0.92;

// CÂMERA AUTOMÁTICA (1.7.1)
// Distância percorrida antes de começar a acompanhar suavemente.
export var distanciaAcompanhamentoCamera = 3;
// Intensidade do giro suave por segundo: 1.2 mais devagar, 2.5 mais rápido.
export var suavidadeAcompanhamentoCamera = 1.8;

// Alpha 1.0: sons ambientais opcionais, em loop quando entrar no jogo.
// Deixe vazio para jogar sem áudio. O navegador só toca após clicar JOGAR.
export var somAmbiente = ""; // Ex.: "sons/ambiente.mp3"
export var somAmbienteCidade = ""; // Ex.: "sons/cidade.mp3" (opcional)
export var somAmbienteFloresta = ""; // Ex.: "sons/floresta.mp3" (opcional)
export var volumeAmbiente = 0.28; // 0.0 = mudo; 1.0 = volume máximo




export var iluminacaoDosPostesDeLuz = 20;//quanto de luz os postem emitem. Padrao 11
export var corDosPostesDeLuz = 0xffd29b;
export var tamanhoLuzDoPoste = 23;//padrao era 13, simboliza quantos blocos a luz atinge de raio
export var suavidadeDaLuzDoPoste = .7;


export var distanciaRenderPC = 5;
export var distanciaRenderMobile = 4;
export var distanciaVisibilidade = 1000;//Distancia que a camera renderiza. original 480

export var escuridaoNoturnaMinima = .50;//original era 0.7, mas fica muito escuro