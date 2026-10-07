/**
 * ============================================================
 *  CONFIGURAÇÃO DO PORTFÓLIO
 *  Edite este arquivo para trocar seus dados e seus projetos.
 *  O mundo (estradas, pedestais, minimapa) se monta sozinho
 *  a partir da lista PROJECTS.
 * ============================================================
 */

export const OWNER = {
  name: 'Lucas Baccelli',
  role: 'Desenvolvedor de Software',
  tagline: 'Siga as estradas de neon e descubra meus projetos.',
  about: [
    'Sou desenvolvedor de software e gosto de transformar ideias em produtos digitais que as pessoas realmente usam.',
    'Trabalho de ponta a ponta: interfaces modernas, APIs robustas, bancos de dados e automação.',
    'Este portfólio é um jogo, porque acredito que mostrar é melhor do que contar.',
  ],
  skills: ['JavaScript', 'TypeScript', 'React', 'Node.js', 'Python', 'FastAPI', 'SQL', 'Three.js'],
  links: [
    { label: 'GitHub', url: 'https://github.com/SEU-USUARIO' },
    { label: 'LinkedIn', url: 'https://www.linkedin.com/in/SEU-USUARIO' },
    { label: 'E-mail', url: 'mailto:seu@email.com' },
  ],
};

/**
 * Cada projeto vira um pedestal com holograma no mundo.
 *  - image: opcional. Coloque um print em /public/projects/ e use 'projects/arquivo.jpg'.
 *           Sem imagem, o jogo gera uma prévia estilizada automaticamente.
 *  - color: cor neon do pedestal/holograma.
 *  - url:   site aberto ao apertar "E".
 */
export const PROJECTS = [
  {
    id: 'neon-dashboard',
    title: 'Neon Dashboard',
    subtitle: 'Painel analítico em tempo real',
    description:
      'Dashboard com métricas ao vivo via WebSocket, gráficos interativos e alertas configuráveis para times de operação.',
    tags: ['React', 'Node.js', 'WebSocket', 'D3'],
    year: 2026,
    url: 'https://example.com',
    color: '#00f0ff',
    image: null,
  },
  {
    id: 'synth-chat',
    title: 'Synth Chat',
    subtitle: 'Assistente conversacional com IA',
    description:
      'Chatbot com memória de contexto, busca em documentos internos (RAG) e integração com ferramentas corporativas.',
    tags: ['Python', 'FastAPI', 'LLM', 'RAG'],
    year: 2026,
    url: 'https://example.com',
    color: '#ff2a9d',
    image: null,
  },
  {
    id: 'grid-store',
    title: 'Grid Store',
    subtitle: 'E-commerce headless',
    description:
      'Loja virtual rápida com catálogo dinâmico, carrinho persistente e checkout integrado a meios de pagamento.',
    tags: ['Next.js', 'Stripe', 'PostgreSQL'],
    year: 2025,
    url: 'https://example.com',
    color: '#ffd319',
    image: null,
  },
  {
    id: 'outrun-maps',
    title: 'Outrun Maps',
    subtitle: 'Calculadora de rotas e frete',
    description:
      'Ferramenta que calcula distâncias, prazos e custos de frete a partir de CEPs, com mapa interativo e exportação.',
    tags: ['TypeScript', 'Leaflet', 'APIs REST'],
    year: 2025,
    url: 'https://example.com',
    color: '#39ff88',
    image: null,
  },
  {
    id: 'pixel-portal',
    title: 'Pixel Portal',
    subtitle: 'Portal do gestor',
    description:
      'Portal interno com autenticação corporativa, controle de acesso por perfil e relatórios exportáveis.',
    tags: ['React', 'Azure AD', 'MySQL'],
    year: 2025,
    url: 'https://example.com',
    color: '#b26bff',
    image: null,
  },
  {
    id: 'laser-bot',
    title: 'Laser Bot Hub',
    subtitle: 'Central de automações',
    description:
      'Orquestrador de bots e rotinas agendadas, com painel de execução, logs em tempo real e reprocessamento.',
    tags: ['Python', 'Celery', 'Docker'],
    year: 2024,
    url: 'https://example.com',
    color: '#ff7a29',
    image: null,
  },
  {
    id: 'retro-guide',
    title: 'Retro Guide',
    subtitle: 'Guia interativo de onboarding',
    description:
      'Guia digital para novos colaboradores, com trilhas de conteúdo, busca inteligente e versão mobile.',
    tags: ['Vue', 'PWA', 'Firebase'],
    year: 2024,
    url: 'https://example.com',
    color: '#4d7cff',
    image: null,
  },
];
