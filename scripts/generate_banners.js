const { chromium } = require('playwright');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'banners');

const baseCSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  width: 1080px; height: 1080px;
  font-family: 'Inter', 'Segoe UI Emoji', 'Apple Color Emoji', system-ui, sans-serif;
  color: white;
  overflow: hidden;
  position: relative;
}
.bg {
  position: absolute; inset: 0;
  background: linear-gradient(145deg, #0F172A 0%, #1E293B 50%, #0F172A 100%);
  z-index: 0;
}
.glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.3;
  z-index: 1;
}
.content {
  position: relative; z-index: 2;
  width: 100%; height: 100%;
  display: flex; flex-direction: column;
  align-items: center;
  padding: 50px 60px;
}
.badge {
  padding: 10px 28px;
  border-radius: 999px;
  font-size: 19px;
  font-weight: 700;
  margin-bottom: 18px;
  letter-spacing: 0.3px;
}
.logo {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 10px;
  color: rgba(255,255,255,0.35);
  margin-bottom: 8px;
}
.accent-line {
  width: 50px;
  height: 3px;
  border-radius: 2px;
  margin-bottom: 16px;
}
h1 {
  font-size: 46px;
  font-weight: 900;
  text-align: center;
  margin-bottom: 10px;
  line-height: 1.15;
}
.sub {
  font-size: 21px;
  color: #94A3B8;
  text-align: center;
  margin-bottom: 28px;
  max-width: 820px;
  line-height: 1.4;
}
.chat-box {
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 24px;
  padding: 20px 24px;
  width: 100%;
  max-width: 780px;
  backdrop-filter: blur(10px);
  margin-bottom: 24px;
}
.chat-title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 2.5px;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.messages { overflow: hidden; }
.msg-row { clear: both; overflow: hidden; margin-bottom: 8px; }
.msg-label {
  font-size: 11px;
  font-weight: 700;
  margin-bottom: 4px;
  clear: both;
}
.msg-label.user { float: right; }
.msg-label.bot { float: left; }
.msg-user {
  background: #22C55E;
  color: white;
  padding: 12px 20px;
  border-radius: 20px 20px 4px 20px;
  font-size: 17px;
  display: inline-block;
  max-width: 75%;
  float: right;
  clear: both;
  line-height: 1.4;
  font-weight: 500;
}
.msg-bot {
  background: rgba(51, 65, 85, 0.9);
  color: #E2E8F0;
  padding: 12px 20px;
  border-radius: 20px 20px 20px 4px;
  font-size: 17px;
  display: inline-block;
  max-width: 75%;
  float: left;
  clear: both;
  line-height: 1.4;
}
.msg-bot .highlight { color: #38BDF8; font-weight: 600; }
.audio-bubble {
  padding: 10px 18px;
  border-radius: 20px;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
}
.audio-bubble.user { background: #22C55E; float: right; clear: both; }
.audio-bubble.bot { background: rgba(51,65,85,0.9); float: left; clear: both; color: #E2E8F0; }
.waveform { display: flex; align-items: center; gap: 3px; height: 24px; }
.waveform .bar { width: 3px; border-radius: 2px; background: rgba(255,255,255,0.6); }
.location-bubble {
  background: #22C55E;
  padding: 14px 20px;
  border-radius: 20px 20px 4px 20px;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  float: right;
  clear: both;
}
.location-bubble .pin { font-size: 28px; }
.location-bubble .loc-text { font-size: 15px; font-weight: 600; }
.location-bubble .loc-sub { font-size: 12px; opacity: 0.8; }
.file-bubble {
  background: rgba(51,65,85,0.9);
  padding: 14px 20px;
  border-radius: 20px 20px 20px 4px;
  display: inline-flex;
  align-items: center;
  gap: 14px;
  float: left;
  clear: both;
  color: #E2E8F0;
}
.file-icon { font-size: 28px; }
.file-name { font-size: 15px; font-weight: 600; }
.file-meta { font-size: 12px; color: #94A3B8; }
.cta {
  padding: 16px 44px;
  border-radius: 999px;
  font-size: 21px;
  font-weight: 700;
  text-align: center;
  box-shadow: 0 4px 24px rgba(0,0,0,0.3);
}
.footer {
  color: #475569;
  font-size: 13px;
  margin-top: 14px;
  letter-spacing: 1px;
}
.spacer { flex: 1; }
`;

function waveformBars(seed = 42) {
  const bars = [];
  let s = seed;
  for (let i = 0; i < 20; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const h = 6 + (s % 20);
    bars.push(`<div class="bar" style="height:${h}px"></div>`);
  }
  return bars.join('');
}

const banners = [
  // BANNER 1 — Day 0 Welcome
  {
    filename: 'banner_day0_welcome.png',
    accent: '#38BDF8',
    glows: [
      { x: '50%', y: '25%', size: 500, color: '#38BDF8' },
      { x: '20%', y: '75%', size: 350, color: '#818CF8' },
    ],
    badge: { text: '🎁 Bem-vindo ao clube!', bg: 'linear-gradient(90deg, #38BDF8, #818CF8)' },
    headline: 'Prazer, eu sou o Jarvis! 👋',
    sub: 'Acha o melhor preço, monitora promoções e compra pra você',
    chatTitle: '💬 COMO USAR',
    messages: `
      <div class="msg-row"><div class="msg-label user" style="color:#22C55E">você</div></div>
      <div class="msg-row"><div class="msg-user">Oi! 👋</div></div>
      <div class="msg-row"><div class="msg-label bot" style="color:#38BDF8">jarvis</div></div>
      <div class="msg-row"><div class="msg-bot">E aí! 😄 Sou o Jarvis, seu agente de compras inteligente. Acho o melhor preço, monitoro promoções e compro pra você. Bora?</div></div>
    `,
    cta: { text: "Manda um 'Oi' e vem! 💬", bg: 'linear-gradient(90deg, #38BDF8, #818CF8)' },
  },

  // BANNER 2 — Day 3 Voice
  {
    filename: 'banner_day3_voice.png',
    accent: '#22C55E',
    glows: [
      { x: '50%', y: '20%', size: 450, color: '#22C55E' },
      { x: '80%', y: '70%', size: 300, color: '#10B981' },
    ],
    badge: { text: '🎁 Poder novo desbloqueado!', bg: 'linear-gradient(90deg, #22C55E, #10B981)' },
    headline: 'Bora conversar de verdade? 🎙️',
    sub: 'Manda um áudio e eu respondo em áudio — como conversar com um amigo',
    chatTitle: '💬 COMO USAR',
    messages: `
      <div class="msg-row"><div class="msg-label user" style="color:#22C55E">você</div></div>
      <div class="msg-row"><div class="audio-bubble user">🎤 <div class="waveform">${waveformBars(42)}</div> <span>0:05</span></div></div>
      <div class="msg-row"><div class="msg-label bot" style="color:#22C55E">jarvis</div></div>
      <div class="msg-row"><div class="audio-bubble bot">🎤 <div class="waveform">${waveformBars(99)}</div> <span>0:08</span></div></div>
      <div class="msg-row"><div class="msg-label bot" style="color:#22C55E">jarvis</div></div>
      <div class="msg-row"><div class="msg-bot">Achei 3 voos pra São Paulo a partir de $350! ✈️ Quer ver os detalhes?</div></div>
    `,
    cta: { text: 'Grava um áudio agora! 🎤', bg: 'linear-gradient(90deg, #22C55E, #10B981)' },
  },

  // BANNER 3 — Day 5 Shopping
  {
    filename: 'banner_day5_shopping.png',
    accent: '#F59E0B',
    glows: [
      { x: '50%', y: '25%', size: 480, color: '#F59E0B' },
      { x: '15%', y: '70%', size: 320, color: '#EF4444' },
    ],
    badge: { text: '🎁 Presente desbloqueado!', bg: 'linear-gradient(90deg, #F59E0B, #EF4444)' },
    headline: 'Seu Personal Shopper tá ON 🛒',
    sub: 'Eu busco, comparo preços e encontro o melhor negócio pra você',
    chatTitle: '💬 COMO USAR',
    messages: `
      <div class="msg-row"><div class="msg-label user" style="color:#22C55E">você</div></div>
      <div class="msg-row"><div class="msg-user">Procura óculos Meta Ray Ban pra mim 🕶️</div></div>
      <div class="msg-row"><div class="msg-label bot" style="color:#F59E0B">jarvis</div></div>
      <div class="msg-row"><div class="msg-bot">Achei! 🕶️ Meta Ray-Ban a partir de <span class="highlight">US$ 263</span> na Amazon. Quer que eu compare em outras lojas?</div></div>
    `,
    cta: { text: 'Pede qualquer produto! 🛍️', bg: 'linear-gradient(90deg, #F59E0B, #EF4444)' },
  },

  // BANNER 4 — Day 8 Location
  {
    filename: 'banner_day8_location.png',
    accent: '#EF4444',
    glows: [
      { x: '55%', y: '20%', size: 450, color: '#EF4444' },
      { x: '25%', y: '75%', size: 350, color: '#F97316' },
    ],
    badge: { text: '🎁 Poder novo desbloqueado!', bg: 'linear-gradient(90deg, #EF4444, #F97316)' },
    headline: 'Agora eu sei onde você tá! 📍',
    sub: 'Compartilha sua localização e eu encontro tudo pertinho',
    chatTitle: '💬 COMO USAR',
    messages: `
      <div class="msg-row"><div class="msg-label user" style="color:#22C55E">você</div></div>
      <div class="msg-row">
        <div class="location-bubble">
          <div class="pin">📍</div>
          <div><div class="loc-text">Minha Localização</div><div class="loc-sub">Compartilhada agora</div></div>
        </div>
      </div>
      <div class="msg-row"><div class="msg-label bot" style="color:#EF4444">jarvis</div></div>
      <div class="msg-row"><div class="msg-bot">📍 Localização salva! Agora posso buscar tudo perto de você!</div></div>
      <div class="msg-row"><div class="msg-label user" style="color:#22C55E">você</div></div>
      <div class="msg-row"><div class="msg-user">Pizza perto de mim 🍕</div></div>
      <div class="msg-row"><div class="msg-label bot" style="color:#EF4444">jarvis</div></div>
      <div class="msg-row"><div class="msg-bot">🍕 Achei 5 pizzarias num raio de 2 miles!</div></div>
    `,
    cta: { text: 'Toca no 📎 → Localização → Enviar', bg: 'linear-gradient(90deg, #EF4444, #F97316)' },
  },

  // BANNER 5 — Day 11 Restaurants
  {
    filename: 'banner_day11_restaurants.png',
    accent: '#EC4899',
    glows: [
      { x: '45%', y: '25%', size: 480, color: '#EC4899' },
      { x: '75%', y: '70%', size: 300, color: '#8B5CF6' },
    ],
    badge: { text: '🎁 Presente desbloqueado!', bg: 'linear-gradient(90deg, #EC4899, #8B5CF6)' },
    headline: 'Seu Guia Gastronômico 🍽️',
    sub: 'Restaurantes reais com avaliações, telefone e link do Google Maps',
    chatTitle: '💬 COMO USAR',
    messages: `
      <div class="msg-row"><div class="msg-label user" style="color:#22C55E">você</div></div>
      <div class="msg-row"><div class="msg-user">Restaurante japonês bom perto de mim 🍣</div></div>
      <div class="msg-row"><div class="msg-label bot" style="color:#EC4899">jarvis</div></div>
      <div class="msg-row"><div class="msg-bot">🍽️ <strong>Nobu Miami</strong> ⭐ 4.7 (2,340 reviews)<br>📍 4525 Collins Ave — 0.8 miles<br>📞 (786) 866-3999<br>🗺️ <span class="highlight">Abrir no Maps</span><br>Quer reservar?</div></div>
    `,
    cta: { text: 'Pede um restaurante! 🍣', bg: 'linear-gradient(90deg, #EC4899, #8B5CF6)' },
  },

  // BANNER 6 — Day 14 Travel
  {
    filename: 'banner_day14_travel.png',
    accent: '#8B5CF6',
    glows: [
      { x: '50%', y: '20%', size: 500, color: '#8B5CF6' },
      { x: '20%', y: '80%', size: 350, color: '#6366F1' },
    ],
    badge: { text: '🎁 Poder novo desbloqueado!', bg: 'linear-gradient(90deg, #8B5CF6, #6366F1)' },
    headline: 'Viaje com o Jarvis ✈️',
    sub: 'Roteiros completos, voos, hotéis e dicas locais para qualquer lugar do mundo',
    chatTitle: '💬 COMO USAR',
    messages: `
      <div class="msg-row"><div class="msg-label user" style="color:#22C55E">você</div></div>
      <div class="msg-row"><div class="msg-user">Faz um roteiro de 5 dias em Marrocos 🇲🇦</div></div>
      <div class="msg-row"><div class="msg-label bot" style="color:#8B5CF6">jarvis</div></div>
      <div class="msg-row"><div class="msg-bot">🇲🇦 <strong>Roteiro Marrocos — 5 dias:</strong><br>Dia 1: Marrakech — Jemaa el-Fnaa + Medina<br>Dia 2: Atlas Mountains — trilha + almoço berber<br>Dia 3: Deserto do Sahara...<br>Quer que eu busque <span class="highlight">voos e hotéis</span>?</div></div>
    `,
    cta: { text: 'Pra onde você quer ir? 🌍', bg: 'linear-gradient(90deg, #8B5CF6, #6366F1)' },
  },

  // BANNER 7 — Day 18 Documents
  {
    filename: 'banner_day18_documents.png',
    accent: '#14B8A6',
    glows: [
      { x: '50%', y: '25%', size: 460, color: '#14B8A6' },
      { x: '80%', y: '75%', size: 320, color: '#06B6D4' },
    ],
    badge: { text: '🎁 Presente desbloqueado!', bg: 'linear-gradient(90deg, #14B8A6, #06B6D4)' },
    headline: 'Documentos na hora! 📄',
    sub: 'Contratos, cartas, relatórios — tudo em PDF, direto no seu celular',
    chatTitle: '💬 COMO USAR',
    messages: `
      <div class="msg-row"><div class="msg-label user" style="color:#22C55E">você</div></div>
      <div class="msg-row"><div class="msg-user">Escreve um contrato de prestação de serviços 📝</div></div>
      <div class="msg-row"><div class="msg-label bot" style="color:#14B8A6">jarvis</div></div>
      <div class="msg-row"><div class="msg-bot">Pronto! 📄 Seu contrato tá aqui, fresquinho!</div></div>
      <div class="msg-row"><div class="msg-label bot" style="color:#14B8A6">jarvis</div></div>
      <div class="msg-row">
        <div class="file-bubble">
          <div class="file-icon">📎</div>
          <div><div class="file-name">Contrato_Prestacao_Servicos.pdf</div><div class="file-meta">PDF • 26 KB • Toque para baixar</div></div>
        </div>
      </div>
    `,
    cta: { text: 'Pede qualquer documento! 📝', bg: 'linear-gradient(90deg, #14B8A6, #06B6D4)' },
  },

  // BANNER 8 — Day 21 Full Power (special layout)
  {
    filename: 'banner_day21_fullpower.png',
    accent: '#8B5CF6',
    glows: [
      { x: '30%', y: '40%', size: 500, color: '#38BDF8' },
      { x: '70%', y: '60%', size: 500, color: '#8B5CF6' },
    ],
    badge: { text: '🏆 Level máximo!', bg: 'linear-gradient(90deg, #F59E0B, #EF4444)' },
    headline: 'Você tem um Concierge Completo 🚀',
    sub: '12 superpoderes desbloqueados:',
    isSpecial: true,
    powers: [
      ['🛒', 'Compras'],     ['✈️', 'Viagens'],
      ['🍽️', 'Restaurantes'],['🎫', 'Eventos'],
      ['🏥', 'Saúde'],       ['💰', 'Finanças'],
      ['📚', 'Educação'],    ['📄', 'Documentos'],
      ['🏠', 'Casa'],        ['⚖️', 'Jurídico'],
      ['🚗', 'Transporte'],  ['💬', 'Comunicação'],
    ],
    cta: { text: 'O Jarvis é seu. Bora! 🚀', bg: 'linear-gradient(90deg, #38BDF8, #8B5CF6)' },
  },
];

function buildHTML(b) {
  const glowDivs = b.glows.map(g =>
    `<div class="glow" style="left:${g.x};top:${g.y};width:${g.size}px;height:${g.size}px;background:${g.color};transform:translate(-50%,-50%)"></div>`
  ).join('');

  let middle;
  if (b.isSpecial) {
    // Grid layout for banner 8
    const cells = b.powers.map(([emoji, name]) =>
      `<div class="power-cell"><span class="power-emoji">${emoji}</span><span class="power-name">${name}</span></div>`
    ).join('');
    middle = `
      <div class="powers-grid">${cells}</div>
    `;
  } else {
    middle = `
      <div class="chat-box">
        <div class="chat-title" style="color:${b.accent}">${b.chatTitle}</div>
        <div class="messages">${b.messages}</div>
      </div>
    `;
  }

  const extraCSS = b.isSpecial ? `
    .powers-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      width: 100%;
      max-width: 700px;
      margin-bottom: 24px;
    }
    .power-cell {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      gap: 14px;
      transition: all 0.2s;
    }
    .power-emoji { font-size: 28px; }
    .power-name { font-size: 19px; font-weight: 700; }
  ` : '';

  return `
    <html><head><style>${baseCSS}${extraCSS}</style></head>
    <body>
      <div class="bg"></div>
      ${glowDivs}
      <div class="content">
        <div class="spacer" style="flex:0.4"></div>
        <div class="badge" style="background:${b.badge.bg}">${b.badge.text}</div>
        <div class="logo">J A R V I S</div>
        <div class="accent-line" style="background:${b.accent}"></div>
        <h1>${b.headline}</h1>
        <div class="sub">${b.sub}</div>
        ${middle}
        <div class="cta" style="background:${b.cta.bg}">${b.cta.text}</div>
        <div class="footer">payjarvis.com</div>
        <div class="spacer" style="flex:0.6"></div>
      </div>
    </body></html>
  `;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1080, height: 1080 });

  console.log('🎨 Gerando 8 banners premium via Playwright...\n');

  for (const b of banners) {
    const html = buildHTML(b);
    await page.setContent(html, { waitUntil: 'networkidle' });
    // Wait for font loading
    await page.waitForTimeout(500);
    const outputPath = path.join(OUTPUT_DIR, b.filename);
    await page.screenshot({ path: outputPath });
    console.log(`  ✅ ${b.filename}`);
  }

  await browser.close();
  console.log(`\n✅ Todos os 8 banners salvos em ${OUTPUT_DIR}`);
})();
