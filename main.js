/* ===== NexusAI — main.js ===== */

// ── Navbar scroll effect ─────────────────────────────────
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 40);
}, { passive: true });

// ── Mobile hamburger ─────────────────────────────────────
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobileMenu');
hamburger.addEventListener('click', () => {
  mobileMenu.classList.toggle('open');
});
mobileMenu.querySelectorAll('a').forEach(a => {
  a.addEventListener('click', () => mobileMenu.classList.remove('open'));
});

// ── Smooth-scroll for all anchor links ───────────────────
document.querySelectorAll('a[href^="#"]').forEach(link => {
  link.addEventListener('click', e => {
    const target = document.querySelector(link.getAttribute('href'));
    if (target) {
      e.preventDefault();
      const offset = 80;
      window.scrollTo({ top: target.offsetTop - offset, behavior: 'smooth' });
    }
  });
});

// ── Animated counter ─────────────────────────────────────
function animateCounter(el) {
  const target = parseInt(el.dataset.target, 10);
  const duration = 1800;
  const start = performance.now();
  const update = (now) => {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    el.textContent = Math.floor(eased * target);
    if (progress < 1) requestAnimationFrame(update);
    else el.textContent = target;
  };
  requestAnimationFrame(update);
}

// ── Intersection Observer for reveal animations ───────────
const observerOptions = { threshold: 0.15, rootMargin: '0px 0px -40px 0px' };

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const el = entry.target;
    const delay = parseInt(el.dataset.delay || '0', 10);
    setTimeout(() => el.classList.add('visible'), delay);
    revealObserver.unobserve(el);
  });
}, observerOptions);

document.querySelectorAll('.service-card').forEach(card => revealObserver.observe(card));

// Counter observer (hero stats)
const counterObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.querySelectorAll('.stat__num').forEach(animateCounter);
    counterObserver.unobserve(entry.target);
  });
}, { threshold: 0.5 });

const heroStats = document.querySelector('.hero__stats');
if (heroStats) counterObserver.observe(heroStats);

// ── Particle canvas ───────────────────────────────────────
(function initParticles() {
  const canvas = document.getElementById('particleCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let W, H, particles = [], mouse = { x: null, y: null };
  const COUNT = 80;
  const MAX_DIST = 140;

  function resize() {
    W = canvas.width  = canvas.offsetWidth;
    H = canvas.height = canvas.offsetHeight;
  }

  class Particle {
    constructor() { this.reset(true); }
    reset(init) {
      this.x  = Math.random() * W;
      this.y  = init ? Math.random() * H : H + 10;
      this.vx = (Math.random() - 0.5) * 0.4;
      this.vy = -(Math.random() * 0.4 + 0.1);
      this.r  = Math.random() * 1.5 + 0.5;
      this.alpha = Math.random() * 0.5 + 0.2;
    }
    update() {
      this.x += this.vx;
      this.y += this.vy;
      if (this.y < -10 || this.x < -10 || this.x > W + 10) this.reset(false);
    }
    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(129,140,248,${this.alpha})`;
      ctx.fill();
    }
  }

  function init() {
    particles = Array.from({ length: COUNT }, () => new Particle());
  }

  function drawLines() {
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MAX_DIST) {
          const alpha = (1 - dist / MAX_DIST) * 0.2;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(99,102,241,${alpha})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }
      // Mouse interaction
      if (mouse.x !== null) {
        const dx = particles[i].x - mouse.x;
        const dy = particles[i].y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MAX_DIST * 1.4) {
          const alpha = (1 - dist / (MAX_DIST * 1.4)) * 0.35;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.strokeStyle = `rgba(6,182,212,${alpha})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }
    }
  }

  function loop() {
    ctx.clearRect(0, 0, W, H);
    drawLines();
    particles.forEach(p => { p.update(); p.draw(); });
    requestAnimationFrame(loop);
  }

  canvas.parentElement.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
  });
  canvas.parentElement.addEventListener('mouseleave', () => {
    mouse.x = null; mouse.y = null;
  });

  resize();
  init();
  loop();
  window.addEventListener('resize', () => { resize(); init(); }, { passive: true });
})();

// ── Live demo form ────────────────────────────────────────
const OFFER_LABELS = {
  ai_receptionist: 'AI Receptionist',
  lead_scraping_outreach: 'Lead Scraping + Outreach',
  customer_support_ai: 'Customer Support AI',
  custom_workflow_automation: 'Custom Workflow Automation',
};

const demoForm = document.getElementById('demoForm');
if (demoForm) {
  const urlInput = document.getElementById('demoUrl');
  const submitBtn = document.getElementById('demoSubmit');
  const status = document.getElementById('demoStatus');
  const statusText = document.getElementById('demoStatusText');
  const errorBox = document.getElementById('demoError');
  const resultBox = document.getElementById('demoResult');

  const setStatus = (text) => {
    statusText.textContent = text;
    status.hidden = false;
  };
  const hideStatus = () => { status.hidden = true; };
  const showError = (msg) => {
    errorBox.textContent = msg;
    errorBox.hidden = false;
  };
  const hideError = () => { errorBox.hidden = true; };

  const renderResult = (data) => {
    document.getElementById('resHostname').textContent = data.hostname;
    document.getElementById('resIndustry').textContent = data.industry;
    document.getElementById('resOffer').textContent =
      OFFER_LABELS[data.best_offer_match] ?? data.best_offer_match;
    document.getElementById('resSummary').textContent = data.company_summary;
    document.getElementById('resRationale').textContent = data.offer_rationale;
    document.getElementById('resFirstLine').textContent = data.personalized_first_line;

    const painsEl = document.getElementById('resPains');
    painsEl.innerHTML = '';
    for (const p of data.likely_pain_points) {
      const li = document.createElement('li');
      li.textContent = p;
      painsEl.appendChild(li);
    }

    const emailsEl = document.getElementById('resEmails');
    emailsEl.innerHTML = '';
    for (const email of data.email_sequence) {
      const card = document.createElement('div');
      card.className = 'demo__email';
      const head = document.createElement('div');
      head.className = 'demo__email-head';
      const day = document.createElement('span');
      day.className = 'demo__email-day';
      day.textContent = `Day ${email.day}`;
      const subj = document.createElement('span');
      subj.className = 'demo__email-subject';
      subj.textContent = email.subject;
      head.appendChild(day);
      head.appendChild(subj);
      const body = document.createElement('div');
      body.className = 'demo__email-body';
      body.textContent = email.body;
      card.appendChild(head);
      card.appendChild(body);
      emailsEl.appendChild(card);
    }

    const usage = data.usage || {};
    document.getElementById('resUsage').textContent =
      `tokens: in=${usage.input_tokens ?? '?'}  out=${usage.output_tokens ?? '?'}`;

    resultBox.hidden = false;
  };

  demoForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (!url) return;

    hideError();
    resultBox.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Working...';

    setStatus('Scraping site...');
    setTimeout(() => {
      if (!status.hidden) setStatus('Analyzing with Claude...');
    }, 2000);
    setTimeout(() => {
      if (!status.hidden) setStatus('Drafting outreach sequence...');
    }, 6000);

    try {
      const res = await fetch('/api/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        showError(data.error || `Request failed (${res.status})`);
      } else {
        renderResult(data);
      }
    } catch (err) {
      showError('Network error. Check your connection and try again.');
    } finally {
      hideStatus();
      submitBtn.disabled = false;
      submitBtn.textContent = 'Generate Outreach';
    }
  });
}

// ── Contact form ──────────────────────────────────────────
const form = document.getElementById('contactForm');
if (form) {
  form.addEventListener('submit', e => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    btn.textContent = 'Sending...';
    btn.disabled = true;

    // Simulate network request
    setTimeout(() => {
      form.innerHTML = `
        <div class="form-success" style="display:block">
          <div class="form-success__icon">✅</div>
          <h3>Message Received!</h3>
          <p>Thanks for reaching out. We'll be in touch within 1 business day.</p>
        </div>`;
    }, 1200);
  });
}
