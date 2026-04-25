(function () {
  const root = document.getElementById("root");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function waitForApp(callback) {
    if (root && root.querySelector(".min-h-screen")) {
      callback();
      return;
    }

    const observer = new MutationObserver(() => {
      if (root && root.querySelector(".min-h-screen")) {
        observer.disconnect();
        callback();
      }
    });

    observer.observe(root || document.body, { childList: true, subtree: true });
  }

  function animateIn(targets) {
    if (reduceMotion) {
      targets.forEach((target) => {
        target.style.opacity = "1";
        target.style.transform = "none";
        target.style.filter = "none";
      });
      return;
    }

    targets.forEach((target, index) => {
      target.classList.add("nothing-reveal");
      target.style.setProperty("opacity", "1", "important");
      target.style.transform = "none";
      target.style.filter = "none";
      target.animate(
        [
          { opacity: 1, transform: "translateY(34px) scale(.985)", filter: "blur(12px)" },
          { opacity: 1, transform: "translateY(0) scale(1)", filter: "blur(0)" },
        ],
        {
          duration: 980,
          delay: 90 + index * 115,
          easing: "cubic-bezier(.16, 1, .3, 1)",
          fill: "both",
        },
      );
    });
  }

  function releaseFramerInlineState(scope) {
    const hidden = scope.querySelectorAll("[style*='opacity: 0']");
    hidden.forEach((target, index) => {
      target.classList.add("nothing-reveal");
      target.style.setProperty("opacity", "1", "important");
      target.animate(
        [
          { opacity: 1, transform: "translateY(26px) scale(.99)", filter: "blur(10px)" },
          { opacity: 1, transform: "translateY(0) scale(1)", filter: "blur(0)" },
        ],
        {
          duration: reduceMotion ? 1 : 760,
          delay: reduceMotion ? 0 : Math.min(index * 55, 420),
          easing: "cubic-bezier(.16, 1, .3, 1)",
          fill: "both",
        },
      );

      window.setTimeout(() => {
        target.style.setProperty("opacity", "1", "important");
        target.style.setProperty("transform", "none", "important");
        target.style.setProperty("filter", "none", "important");
      }, reduceMotion ? 0 : 820 + Math.min(index * 55, 420));
    });
  }

  function createDotField(hero) {
    if (hero.querySelector(".nothing-dot-field")) return;

    const field = document.createElement("div");
    field.className = "nothing-dot-field";
    hero.prepend(field);

    const dots = Array.from({ length: 86 }, (_, index) => {
      const dot = document.createElement("span");
      const x = 4 + Math.random() * 92;
      const y = 10 + Math.random() * 78;
      dot.dataset.x = String(x);
      dot.dataset.y = String(y);
      dot.style.setProperty("--x", `${x}%`);
      dot.style.setProperty("--y", `${y}%`);
      dot.style.setProperty("--s", `${1 + Math.random() * 2.6}px`);
      dot.style.setProperty("--o", `${0.12 + Math.random() * 0.28}`);
      dot.style.setProperty("--delay", `${(index % 13) * -0.18}s`);
      field.appendChild(dot);
      return dot;
    });

    let frame = 0;
    let bounds = hero.getBoundingClientRect();

    function resize() {
      bounds = hero.getBoundingClientRect();
    }

    function move(event) {
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      hero.style.setProperty("--mx", `${x}px`);
      hero.style.setProperty("--my", `${y}px`);

      if (reduceMotion) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        dots.forEach((dot) => {
          const dotX = (Number(dot.dataset.x) / 100) * bounds.width;
          const dotY = (Number(dot.dataset.y) / 100) * bounds.height;
          const dx = dotX - x;
          const dy = dotY - y;
          const distance = Math.hypot(dx, dy);
          const influence = Math.max(0, 1 - distance / 240);
          const push = influence * 22;
          const angle = Math.atan2(dy, dx);
          dot.style.setProperty("--tx", `${Math.cos(angle) * push}px`);
          dot.style.setProperty("--ty", `${Math.sin(angle) * push}px`);
          dot.style.setProperty("--scale", String(1 + influence * 2.4));
          dot.style.setProperty("--o", String(0.16 + influence * 0.72));
        });
      });
    }

    function leave() {
      dots.forEach((dot) => {
        dot.style.setProperty("--tx", "0px");
        dot.style.setProperty("--ty", "0px");
        dot.style.setProperty("--scale", "1");
        dot.style.setProperty("--o", ".2");
      });
    }

    window.addEventListener("resize", resize, { passive: true });
    hero.addEventListener("pointermove", move, { passive: true });
    hero.addEventListener("pointerleave", leave, { passive: true });
  }

  function setupScrollReveals() {
    if (reduceMotion || !("IntersectionObserver" in window)) return;

    const cards = document.querySelectorAll(
      "#root section:not(:first-of-type) .rounded-xl, #root section:not(:first-of-type) .rounded-2xl, #root section:not(:first-of-type) [data-orientation='vertical'] > div",
    );

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          entry.target.animate(
            [
              { opacity: 0, transform: "translateY(28px)", filter: "blur(10px)" },
              { opacity: 1, transform: "translateY(0)", filter: "blur(0)" },
            ],
            {
              duration: 760,
              easing: "cubic-bezier(.16, 1, .3, 1)",
              fill: "both",
            },
          );
        });
      },
      { threshold: 0.16 },
    );

    cards.forEach((card) => observer.observe(card));
  }

  waitForApp(() => {
    const hero = document.querySelector("#root > .min-h-screen > section:first-of-type");
    if (!hero) return;

    createDotField(hero);
    animateIn([
      hero.querySelector("h1"),
      hero.querySelector("p"),
      hero.querySelector(".flex"),
    ].filter(Boolean));
    releaseFramerInlineState(hero);
    window.setTimeout(() => releaseFramerInlineState(document), 350);
    window.setTimeout(() => releaseFramerInlineState(document), 1200);
    setupScrollReveals();
  });
})();
