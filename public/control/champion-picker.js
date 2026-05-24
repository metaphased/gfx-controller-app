// champion-picker.js
// Loads champion list from server, provides searchable picker UI

window.Champions = (function() {
  let _list = []; // [{ name: 'Leblanc', url: '/champions/Leblanc_0.jpg' }, ...]

  async function load() {
    try {
      const res = await fetch('/api/champions');
      const data = await res.json();
      _list = data.champions || [];
      console.log('Champions loaded:', _list.length);
    } catch(e) {
      console.error('Failed to load champions:', e);
    }
  }

  function getList() { return _list; }

  function findByName(name) {
    if (!name) return null;
    const lower = name.toLowerCase().trim();
    return _list.find(c => c.name.toLowerCase() === lower) || null;
  }

  function getUrl(name) {
    const champ = findByName(name);
    return champ ? champ.url : '';
  }

  // Build a searchable picker inside a container element.
  // The dropdown is portalled to document.body with position:fixed so it is
  // never clipped by ancestor overflow or stacking-context issues.
  function buildPicker(container, onSelect, currentValue) {
    // Clean up any previously portalled dropdown for this container
    if (container._champDropdown) {
      container._champDropdown.remove();
      container._champDropdown = null;
    }
    if (container._champScrollCleanup) {
      container._champScrollCleanup();
      container._champScrollCleanup = null;
    }

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
    input.placeholder = 'Search champion…';
    input.value = current ? current.name : '';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('data-form-type', 'other');
    input.setAttribute('data-lpignore', 'true');
    // Readonly trick: Chrome skips credential autofill for readonly inputs.
    // Remove readonly 50ms after focus — Chrome has already decided not to show the picker.
    input.setAttribute('readonly', '');
    input.addEventListener('focus', function() {
      const el = input;
      setTimeout(function() { el.removeAttribute('readonly'); }, 50);
    });

    const clearBtn = document.createElement('button');
    clearBtn.className = 'champ-clear-btn btn btn-sm';
    clearBtn.textContent = '✕';
    clearBtn.title = 'Clear';
    clearBtn.addEventListener('mousedown', function(e) {
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

    // Close dropdown when the scroll container moves (keeps UX clean)
    const mainEl = document.querySelector('.main');
    function onScrollClose() { hideDropdown(); }
    if (mainEl) mainEl.addEventListener('scroll', onScrollClose, { passive: true });
    container._champScrollCleanup = function() {
      if (mainEl) mainEl.removeEventListener('scroll', onScrollClose);
    };

    function renderDropdown(filter) {
      const q = (filter || '').toLowerCase().trim();
      // No artificial cap — show all matches; max-height + overflow-y handles scrolling
      const matches = q ? _list.filter(c => c.name.toLowerCase().includes(q)) : _list;
      dropdown.innerHTML = '';

      if (!matches.length) {
        const none = document.createElement('div');
        none.className = 'champ-no-results';
        none.textContent = q ? 'No match for "' + filter + '"' : 'No champions loaded';
        dropdown.appendChild(none);
        return;
      }

      matches.forEach(function(champ) {
        const disabled = container._disabledNames && container._disabledNames.has(champ.name.toLowerCase());
        const item = document.createElement('div');
        item.className = 'champ-option' + (disabled ? ' champ-option-disabled' : '');

        const img = document.createElement('div');
        img.className = 'champ-option-img';
        img.style.backgroundImage = 'url(' + champ.url + ')';

        const label = document.createElement('span');
        label.textContent = champ.name;

        if (disabled) {
          const badge = document.createElement('span');
          badge.className = 'champ-option-banned-badge';
          badge.textContent = 'FEARLESS';
          item.appendChild(img);
          item.appendChild(label);
          item.appendChild(badge);
          item.title = champ.name + ' is unavailable (fearless draft)';
          item.addEventListener('mousedown', function(e) { e.preventDefault(); });
        } else {
          item.appendChild(img);
          item.appendChild(label);
          item.addEventListener('mousedown', function(e) {
            e.preventDefault();
            input.value = champ.name;
            thumb.style.backgroundImage = 'url(' + champ.url + ')';
            thumb.classList.add('has-img');
            onSelect(champ);
            hideDropdown();
          });
        }

        dropdown.appendChild(item);
      });
    }

    input.addEventListener('focus', function() {
      positionDropdown();
      renderDropdown(input.value);
      dropdown.style.display = 'block';
    });

    input.addEventListener('input', function() {
      positionDropdown();
      renderDropdown(input.value);
      dropdown.style.display = 'block';
      if (!input.value.trim()) {
        thumb.style.backgroundImage = '';
        thumb.classList.remove('has-img');
        onSelect({ name: '', url: '' });
      }
    });

    input.addEventListener('blur', function() {
      input.setAttribute('readonly', ''); // re-arm for next focus
      setTimeout(function() {
        hideDropdown();
        const match = findByName(input.value);
        if (input.value && !match) {
          input.value = '';
          thumb.style.backgroundImage = '';
          thumb.classList.remove('has-img');
          onSelect({ name: '', url: '' });
        }
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

    if (!nameOrUrl) {
      input.value = '';
      thumb.style.backgroundImage = '';
      thumb.classList.remove('has-img');
      return;
    }
    const champ = _list.find(c => c.url === nameOrUrl || c.name.toLowerCase() === nameOrUrl.toLowerCase());
    if (champ) {
      input.value = champ.name;
      thumb.style.backgroundImage = 'url(' + champ.url + ')';
      thumb.classList.add('has-img');
    }
  }

  return { load, getList, findByName, getUrl, buildPicker, updatePickerValue, setPickerLocked };
})();
