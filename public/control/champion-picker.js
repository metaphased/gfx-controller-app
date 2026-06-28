// champion-picker.js
// Searchable image-picker used by the draft controls. One factory powers both the LoL
// champion picker (window.Champions) and the Dota 2 hero picker (window.Heroes) so they share
// the exact same UX + `.champ-*` styling — pick widgets stay consistent across games.

(function () {
  // config: { endpoint, listKey, map(item)->{name,url}, noun }
  function makePicker(config) {
    let _list = []; // [{ name, url }]

    async function load() {
      try {
        const res = await fetch(config.endpoint);
        const data = await res.json();
        _list = ((data && data[config.listKey]) || []).map(config.map).filter(c => c && c.name);
        console.log(config.noun + 's loaded:', _list.length);
      } catch (e) {
        console.error('Failed to load ' + config.noun + 's:', e);
      }
    }

    function getList() { return _list; }

    function findByName(name) {
      if (!name) return null;
      const lower = name.toLowerCase().trim();
      return _list.find(c => c.name.toLowerCase() === lower) || null;
    }

    function getUrl(name) {
      const item = findByName(name);
      return item ? item.url : '';
    }

    // Build a searchable picker inside a container element. The dropdown is portalled to
    // document.body with position:fixed so it is never clipped by ancestor overflow.
    function buildPicker(container, onSelect, currentValue) {
      if (container._champDropdown) { container._champDropdown.remove(); container._champDropdown = null; }
      if (container._champScrollCleanup) { container._champScrollCleanup(); container._champScrollCleanup = null; }

      container.innerHTML = '';
      container.style.position = 'relative';

      const current = currentValue
        ? (_list.find(c => c.url === currentValue || c.name.toLowerCase() === (currentValue || '').toLowerCase()) || null)
        : null;

      const wrapper = document.createElement('div');
      wrapper.className = 'champ-picker-wrapper';

      const thumb = document.createElement('div');
      thumb.className = 'champ-thumb';
      if (current && current.url) {
        thumb.style.backgroundImage = 'url(' + current.url + ')';
        thumb.classList.add('has-img');
      }

      const input = document.createElement('input');
      input.type = 'search';
      input.className = 'champ-search-input';
      input.placeholder = 'Search ' + config.noun + '…';
      input.value = current ? current.name : '';
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('data-form-type', 'other');
      input.setAttribute('data-lpignore', 'true');
      // Readonly trick: Chrome skips credential autofill for readonly inputs.
      input.setAttribute('readonly', '');
      input.addEventListener('focus', function () {
        const el = input;
        setTimeout(function () { el.removeAttribute('readonly'); }, 50);
      });

      const clearBtn = document.createElement('button');
      clearBtn.className = 'champ-clear-btn btn btn-sm';
      clearBtn.textContent = '✕';
      clearBtn.title = 'Clear';
      clearBtn.addEventListener('mousedown', function (e) {
        e.preventDefault();
        input.value = '';
        thumb.style.backgroundImage = '';
        thumb.classList.remove('has-img');
        onSelect({ name: '', url: '' });
        hideDropdown();
      });

      // ── Portalled dropdown ────────────────────────────────────────────────────
      const dropdown = document.createElement('div');
      dropdown.className = 'champ-dropdown';
      dropdown.style.display  = 'none';
      dropdown.style.position = 'fixed';
      dropdown.style.zIndex   = '99999';
      document.body.appendChild(dropdown);
      container._champDropdown = dropdown;

      function positionDropdown() {
        const rect = input.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom - 8;
        dropdown.style.left  = rect.left + 'px';
        dropdown.style.width = rect.width + 'px';
        if (spaceBelow < 240 && rect.top > spaceBelow) {
          dropdown.style.top    = 'auto';
          dropdown.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
        } else {
          dropdown.style.top    = (rect.bottom + 4) + 'px';
          dropdown.style.bottom = 'auto';
        }
      }

      function hideDropdown() { dropdown.style.display = 'none'; }

      const mainEl = document.querySelector('.main');
      function onScrollClose() { hideDropdown(); }
      if (mainEl) mainEl.addEventListener('scroll', onScrollClose, { passive: true });
      container._champScrollCleanup = function () { if (mainEl) mainEl.removeEventListener('scroll', onScrollClose); };

      function renderDropdown(filter) {
        const q = (filter || '').toLowerCase().trim();
        const matches = q ? _list.filter(c => c.name.toLowerCase().includes(q)) : _list;
        dropdown.innerHTML = '';

        if (!matches.length) {
          const none = document.createElement('div');
          none.className = 'champ-no-results';
          none.textContent = q ? 'No match for "' + filter + '"' : 'No ' + config.noun + 's loaded';
          dropdown.appendChild(none);
          return;
        }

        matches.forEach(function (item) {
          const disabled = container._disabledNames && container._disabledNames.has(item.name.toLowerCase());
          const opt = document.createElement('div');
          opt.className = 'champ-option' + (disabled ? ' champ-option-disabled' : '');

          const img = document.createElement('div');
          img.className = 'champ-option-img';
          img.style.backgroundImage = 'url(' + item.url + ')';

          const label = document.createElement('span');
          label.textContent = item.name;

          if (disabled) {
            const badge = document.createElement('span');
            badge.className = 'champ-option-banned-badge';
            badge.textContent = 'USED';
            opt.appendChild(img); opt.appendChild(label); opt.appendChild(badge);
            opt.title = item.name + ' is unavailable';
            opt.addEventListener('mousedown', function (e) { e.preventDefault(); });
          } else {
            opt.appendChild(img); opt.appendChild(label);
            opt.addEventListener('mousedown', function (e) {
              e.preventDefault();
              input.value = item.name;
              thumb.style.backgroundImage = 'url(' + item.url + ')';
              thumb.classList.add('has-img');
              onSelect(item);
              hideDropdown();
            });
          }
          dropdown.appendChild(opt);
        });
      }

      input.addEventListener('focus', function () {
        positionDropdown(); renderDropdown(input.value); dropdown.style.display = 'block';
      });
      input.addEventListener('input', function () {
        positionDropdown(); renderDropdown(input.value); dropdown.style.display = 'block';
        if (!input.value.trim()) { thumb.style.backgroundImage = ''; thumb.classList.remove('has-img'); onSelect({ name: '', url: '' }); }
      });
      input.addEventListener('blur', function () {
        input.setAttribute('readonly', '');
        setTimeout(function () {
          hideDropdown();
          const match = findByName(input.value);
          if (input.value && !match) { input.value = ''; thumb.style.backgroundImage = ''; thumb.classList.remove('has-img'); onSelect({ name: '', url: '' }); }
        }, 160);
      });

      wrapper.appendChild(thumb);
      wrapper.appendChild(input);
      wrapper.appendChild(clearBtn);
      container.appendChild(wrapper);
    }

    function setPickerLocked(container, locked) {
      const input = container.querySelector('.champ-search-input');
      const clearBtn = container.querySelector('.champ-clear-btn');
      if (input) input.disabled = !!locked;
      if (clearBtn) clearBtn.disabled = !!locked;
    }

    function updatePickerValue(container, nameOrUrl) {
      const input = container.querySelector('.champ-search-input');
      const thumb = container.querySelector('.champ-thumb');
      if (!input || !thumb || document.activeElement === input) return;
      if (!nameOrUrl) { input.value = ''; thumb.style.backgroundImage = ''; thumb.classList.remove('has-img'); return; }
      const item = _list.find(c => c.url === nameOrUrl || c.name.toLowerCase() === nameOrUrl.toLowerCase());
      if (item) { input.value = item.name; thumb.style.backgroundImage = 'url(' + item.url + ')'; thumb.classList.add('has-img'); }
    }

    return { load, getList, findByName, getUrl, buildPicker, updatePickerValue, setPickerLocked };
  }

  // LoL champions — /api/champions already returns { name, url }.
  window.Champions = makePicker({ endpoint: '/api/champions', listKey: 'champions', noun: 'champion', map: c => c });
  // Dota 2 heroes — /api/heroes returns { name, slug, img, icon }; the picker wants { name, url }.
  window.Heroes    = makePicker({ endpoint: '/api/heroes',    listKey: 'heroes',    noun: 'hero',     map: h => ({ name: h.name, url: h.img }) });
})();
