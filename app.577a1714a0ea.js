'use strict';
(() => {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const activate = (tab, moveFocus = false) => {
    tabs.forEach(item => {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
    });
    if (moveFocus) tab.focus();
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault(); activate(tabs[next], true);
    });
  });
  const dialog = document.getElementById('image-dialog');
  let opener;
  if (dialog && typeof dialog.showModal === 'function') {
    document.querySelectorAll('[data-zoom]').forEach(link => {
      link.addEventListener('click', event => {
        event.preventDefault(); opener = link;
        const image = link.querySelector('img');
        const target = document.getElementById('dialog-image');
        target.src = link.href; target.alt = image.alt;
        document.getElementById('dialog-caption').textContent = image.alt;
        dialog.showModal(); dialog.scrollTop = 0; dialog.scrollLeft = 0;
      });
    });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
    dialog.addEventListener('close', () => { if (opener) opener.focus({preventScroll:true}); });
  }
  const copy = document.getElementById('copy-command');
  copy?.addEventListener('click', async () => {
    const status = document.getElementById('copy-status');
    try {
      await navigator.clipboard.writeText(document.getElementById('command').textContent);
      status.textContent = copy.dataset.copied; copy.textContent = copy.dataset.copied;
    } catch {
      status.textContent = copy.dataset.failed;
      const range = document.createRange(); range.selectNodeContents(document.getElementById('command'));
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      document.querySelector('.terminal pre').focus();
    }
  });
})();
