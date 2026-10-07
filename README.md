# PortiMax — Portfólio 3D Retrowave

Portfólio interativo em formato de jogo, feito com **Three.js** e **Vite**. O visitante entra por um menu
de jogo, cai numa praça neon e explora estradas retrowave. À beira das estradas ficam pedestais-projetores
com hologramas dos projetos. Os hologramas sempre se viram para o jogador e, quando ele chega perto,
expandem e mostram as informações do projeto. Apertando **E**, o site do projeto abre.

## Rodando

```bash
npm install
npm run dev       # servidor local em http://localhost:5173
npm run build     # gera a versão de produção em /dist
npm run preview   # serve o /dist localmente
```

## Adicionando seus projetos

Tudo fica em [`src/config.js`](src/config.js):

- `OWNER`: seu nome, cargo, textos do "Sobre mim", habilidades e links (GitHub, LinkedIn, e-mail).
- `PROJECTS`: a lista de projetos. Cada item vira um pedestal no mundo.

```js
{
  id: 'meu-projeto',            // único, sem espaços
  title: 'Meu Projeto',
  subtitle: 'Frase curta',
  description: 'Até ~6 linhas aparecem no painel holográfico.',
  tags: ['React', 'Node.js'],
  year: 2026,
  url: 'https://meuprojeto.com', // deixe '' para mostrar "EM BREVE"
  color: '#00f0ff',              // cor neon do pedestal
  image: 'projects/meu-projeto.jpg', // opcional (veja abaixo)
}
```

**Prints dos projetos:** coloque as imagens em `public/projects/` (16:9, ex.: 1280×720) e aponte em `image`.
Sem imagem, o jogo gera uma prévia estilizada automaticamente, no estilo "mock" de site.

O mundo se monta sozinho: os projetos são distribuídos em rodízio entre os 4 braços de estrada que saem da praça
(Norte, Leste, Oeste e Sul). Se você cadastrar muitos projetos, o planeta aumenta de tamanho automaticamente.

## Mundo sem bordas (o "planeta")

Não existe parede invisível: andando reto em qualquer direção, você dá a volta no planeta e chega de novo
à praça pelo lado oposto, sem teleporte nem transição. Duas técnicas trabalham juntas ([src/core/Planet.js](src/core/Planet.js)):

1. **Mundo toroidal (world wrapping)**, a mesma ideia de *Manifold Garden* e *Defender*. O mapa é um quadrado que
   se repete nas duas direções. Cada objeto é sempre desenhado na sua **cópia mais próxima** do jogador, e as estradas
   e a praça são desenhadas pelo shader do chão em coordenadas periódicas. Por isso, quando o jogador cruza a borda,
   nada na tela muda.
2. **Curvatura de horizonte** (o "rolling log" de *Animal Crossing*). Um trecho injetado no `project_vertex` do Three.js
   abaixa cada vértice conforme a distância até a câmera. O chão "cai" no horizonte como um pequeno planeta, os
   pedestais surgem no horizonte conforme você anda, e a costura do mundo fica sempre escondida atrás da curva.

A Av. Meridiano (Norte–Sul) e o Bulevar Equador (Leste–Oeste) são linhas que dão a volta completa. No ponto oposto
à praça há um arco neon ("180°"). Ao completar uma volta, o jogador ganha a conquista **Volta ao mundo**, que revela o truque.
O HUD mostra latitude e longitude. Para ajustar o efeito, altere `CURVATURE` em `Planet.js`.

## A cidade

As avenidas dos projetos continuam as mesmas, e agora são o eixo de uma cidade de verdade
([src/core/CityPlan.js](src/core/CityPlan.js)):

- **Malha de ruas**: a cada 60 unidades corre uma rua paralela a cada avenida, e todas dão a volta no planeta.
  Cada rua tem mão dupla, faixa de estacionamento, faixa amarela dupla, faixas de pedestre, faixas de retenção
  e bueiros. As calçadas têm piso de placas e um filete neon no meio-fio, na cor do bairro. Entre as avenidas
  e a primeira rua fica o calçadão dos projetos (pedestais, palmeiras e a grade neon de sempre).
- **5 bairros**, cada um com seu tipo de quarteirão, altura de prédio e cor:
  **Centro Neon** (arranha-céus e a torre-símbolo com coroa de LED), **Vila Synth** (comércio e prédios residenciais),
  **Jardim Vapor** (casas com telhado, jardins e praças), **Distrito Arcade** (lojas, letreiros e o fliperama) e
  **Zona 180°** (galpões, contêineres e o monumento no ponto mais distante da praça). Ao entrar num bairro aparece
  um letreiro com o nome dele, e o HUD mostra a rua ou avenida em que você está.
- **Quarteirões**: prédios colados na calçada com térreo comercial (vitrines acesas e faixa luminosa), torres sobre
  pódio, sobrados, casas com porta e luz de varanda, galpões com portões de enrolar, estacionamentos, praças com
  fonte, lago ou caminhos, e monumentos.
- **Vida nas calçadas**: postes, árvores em canteiros, bancos, lixeiras, hidrantes, orelhões, pontos de ônibus com
  cartaz luminoso, letreiros verticais de neon (alguns "falhando"), outdoors nos telhados com o seu nome e a sua stack,
  caixas d'água e ar-condicionado nos telhados.
- **Trânsito de rua** ([src/world/StreetTraffic.js](src/world/StreetTraffic.js)): carros andam pela direita, mantêm
  distância do carro da frente, acendem a luz de freio, respeitam os semáforos (inclusive ao cruzar as avenidas dos
  projetos) e param se o jogador estiver na frente, buzinando se ele não sair. Os semáforos de cada cruzamento usam a
  mesma conta no JavaScript e no shader das lentes, e cada braço leva a placa azul com o nome da rua transversal.
  Uma simulação de 3 minutos (96 carros, 60 fps) não registrou nenhuma colisão nem carro travado.
- **Minimapa** com a planta dos quarteirões e dos prédios, e colisão com caixas (prédios, carros) numa grade espacial.

## Um mundo vivo

- **Hologramas que "ligam"**: ao chegar perto, as cantoneiras piscam como lâmpada fluorescente, os anéis de LED da
  base acendem de baixo para cima, uma linha de luz varre a tela e o painel de informações abre como um display.
  Todas as transições usam molas com amortecimento (sem movimentos lineares "duros").
- **Cidade neon**: prédios com janelas que acendem e apagam devagar, faixas de LED subindo pelas quinas e
  antenas com luz de aviso; postes de luz ao longo das ruas (alguns com defeito, piscando); um fliperama com
  letreiro de neon e lâmpadas correndo.
- **Trânsito aéreo**: cada avenida tem duas faixas de altitude (rápida e lenta) e as avenidas ficam em alturas
  diferentes, então o cruzamento é seguro. Os carros mantêm distância do carro da frente e desviam dos letreiros e arcos
  por cima, por baixo ou pelo lado, inclinando o nariz e as asas na manobra. Uma simulação de 3 minutos
  (18 carros, 60 fps) não registrou nenhuma colisão.
- **No ar**: carros voadores com rastros de luz que dão a volta no planeta pelas estradas, um dirigível com painel de
  LED (matriz de pontos) rolando o seu nome, vaga-lumes e estrelas cadentes.
- **Câmera**: inclina levemente ao andar de lado e "afunda" com uma mola ao aterrissar de um pulo.

Tudo que se repete é desenhado com instancing (um draw call por tipo de objeto).

## Controles

| Tecla | Ação |
| --- | --- |
| W A S D / setas | Mover |
| Mouse | Olhar |
| Shift | Correr |
| Espaço | Pular |
| E | Abrir projeto / interagir |
| Q | Radar: um pulso revela onde estão todos os projetos |
| Tab | Lista de projetos: marcar rota, viagem rápida ou abrir o site |
| M | Liga/desliga música |
| Esc | Pausar |

No celular aparecem um joystick virtual, um botão de pulo, um botão **E** e um botão de radar **◎**. Para olhar, é só arrastar o dedo na tela.

## Estrutura

```
src/
  config.js            ← seus dados e projetos
  main.js              ← máquina de estados do jogo (menu → jogo → pausa)
  core/Engine.js       ← renderer, câmera, bloom e efeito CRT
  core/Planet.js       ← mundo sem bordas: wrapping toroidal + curvatura do horizonte
  core/CityPlan.js     ← planta da cidade: ruas, quarteirões, bairros, nomes de rua
  world/World.js       ← monta o mapa a partir dos projetos
  world/City.js        ← prédios, casas, calçadas, semáforos, letreiros, praças, carros estacionados
  world/StreetTraffic.js ← carros de rua, semáforos e faróis
  world/Pedestal.js    ← projetor + holograma (billboard, paralaxe, expansão)
  world/Sky.js         ← céu, estrelas e sol listrado
  world/Ground.js      ← chão: avenidas, praça, ruas, calçadas, parques e estacionamentos (tudo em shader)
  world/Scenery.js     ← montanhas, skyline do horizonte, palmeiras e pirâmides
  world/Props.js       ← postes, prédios neon, antenas e o fliperama
  world/Traffic.js     ← carros voadores
  world/Blimp.js       ← dirigível com painel de LED + vaga-lumes
  world/neon.js        ← materiais de LED, molduras, letreiros com lâmpadas e molas de animação
  player/Player.js     ← câmera em 1ª pessoa, física e colisão
  player/TouchControls.js
  audio/Synth.js       ← trilha synthwave e efeitos 100% sintetizados (sem arquivos)
  ui/UI.js             ← menus, HUD, minimapa, painéis
  utils/textures.js    ← texturas geradas em canvas (prévias, painéis, placas)
```

## Publicando

O build usa caminhos relativos (`base: './'`), então a pasta `dist/` funciona em qualquer hospedagem estática:

- **Vercel / Netlify:** importe o repositório; comando `npm run build`, pasta de saída `dist`.
- **GitHub Pages:** publique o conteúdo de `dist/` (por exemplo, com uma GitHub Action).

## Detalhes técnicos

- Nada de modelos 3D externos: toda a geometria e as texturas são procedurais, então o carregamento é rápido.
- **Bloom seletivo por HDR:** o limiar do bloom é 1.0. Só os materiais "neon" (cor acima de 1) brilham. Textos, telas e
  painéis ficam sempre abaixo de 1, então permanecem nítidos. Regra prática ao criar algo novo: elemento que deve brilhar
  usa `cor.multiplyScalar(1.2 a 1.8)`; elemento que precisa ser lido fica com cor ≤ 0.95.
- Textos gerados em canvas com supersampling (1.5×), contorno escuro e filtragem anisotrópica, sem brilho "assado".
- Iluminação: luz hemisférica suave, um "sol" baixo ao norte com sombras PCF suaves (a câmera de sombra acompanha o jogador),
  uma luz pontual no pedestal mais próximo com a cor do projeto, e poças de luz colorida no chão.
- Rede de segurança no pós-processamento: pixels NaN/infinitos são zerados antes do bloom (um único pixel inválido
  seria espalhado pelo bloom e apagaria a tela inteira).
- Shader CRT sutil: scanlines leves, aberração cromática só nas bordas da tela, vinheta e grão quase imperceptíveis.
- Hologramas com shader próprio: scanlines, glitch, aberração cromática e bordas brilhantes. Eles ficam mais estáveis
  conforme o jogador se aproxima.
- O progresso (projetos descobertos) e as configurações ficam salvos no `localStorage`.
- Opção de qualidade gráfica baixa nas configurações (desliga as sombras e reduz a resolução), para máquinas mais fracas.
- Depuração: abra com `?debug` na URL para expor `window.__portimax` no console.
