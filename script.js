(() => {
  "use strict";

  const STORAGE_KEY = "dear-day-journal-entries";
  const moods = ["😊", "🥰", "😌", "🌱", "🥺", "☁️"];
  const form = document.querySelector("#entry-form");
  const titleInput = document.querySelector("#entry-title");
  const bodyInput = document.querySelector("#entry-body");
  const entryList = document.querySelector("#entry-list");
  const emptyState = document.querySelector("#empty-state");
  const emptyTitle = document.querySelector("#empty-title");
  const emptyDescription = document.querySelector("#empty-description");
  const searchInput = document.querySelector("#search-input");
  const formMessage = document.querySelector("#form-message");
  const saveLabel = document.querySelector("#save-label");
  const cancelButton = document.querySelector("#cancel-edit");
  const todayLabel = document.querySelector("#today-label");
  const toast = document.querySelector("#toast");
  const loadingScreen = document.querySelector("#loading-screen");
  const saveButton = document.querySelector("#save-entry");
  const exportButton = document.querySelector("#export-entries");

  let entries = [];
  let selectedMood = moods[0];
  let currentView = "all";
  let editingId = null;
  let toastTimer;
  let databaseReady = false;

  function hideLoadingScreen() {
    window.setTimeout(() => {
      loadingScreen.classList.add("is-hidden");
      window.setTimeout(() => {
        loadingScreen.hidden = true;
      }, 450);
    }, 700);
  }

  function loadLegacyEntries() {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) throw new Error("Saved journal data is not a list.");
      return parsed.filter((entry) =>
        entry &&
        typeof entry.id === "string" &&
        typeof entry.title === "string" &&
        typeof entry.body === "string" &&
        typeof entry.createdAt === "string" &&
        typeof entry.mood === "string"
      );
    } catch (error) {
      console.error("Unable to load saved journal entries for database migration.", error);
      throw new Error("Your saved browser entries couldn't be read for migration.");
    }
  }

  async function apiRequest(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `The journal database returned an error (${response.status}).`);
    }
    return result;
  }

  async function initializeDatabase() {
    let legacyEntries = [];
    try {
      legacyEntries = loadLegacyEntries();
    } catch (error) {
      console.error("Unable to read browser entries for database migration.", error);
      showToast(error.message);
    }
    try {
      if (legacyEntries.length) {
        const result = await apiRequest("/api/entries/import", {
          method: "POST",
          body: JSON.stringify({ entries: legacyEntries })
        });
        entries = result.entries;
        try {
          window.localStorage.removeItem(STORAGE_KEY);
        } catch (error) {
          console.error("Unable to remove migrated browser entries.", error);
        }
        showToast("Your saved moments are safely in your diary ♡");
      } else {
        entries = await apiRequest("/api/entries");
      }
      databaseReady = true;
      saveButton.disabled = false;
      exportButton.disabled = false;
      formMessage.textContent = "";
    } catch (error) {
      console.error("Unable to connect to the journal database.", error);
      formMessage.textContent = "Couldn't connect to your journal database. Please restart the app and try again.";
      showToast("Your diary database couldn't be reached.");
    }
    render();
    hideLoadingScreen();
  }

  function formatDate(dateString) {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return "a little while ago";
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  }

  function getDayKey(date) {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }

  function calculateStreak() {
    const days = new Set(entries.map((entry) => {
      const date = new Date(entry.createdAt);
      return Number.isNaN(date.getTime()) ? null : getDayKey(date);
    }).filter(Boolean));
    const cursor = new Date();
    if (!days.has(getDayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    let streak = 0;
    while (days.has(getDayKey(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  function updateStats() {
    document.querySelector("#entry-count").textContent = String(entries.length);
    document.querySelector("#stat-total").textContent = String(entries.length);
    document.querySelector("#stat-favorites").textContent = String(entries.filter((entry) => entry.favorite).length);
    document.querySelector("#stat-streak").textContent = String(calculateStreak());
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
  }

  function updateCharacterCounts() {
    document.querySelector("#title-count").textContent = `${titleInput.value.length} / ${titleInput.maxLength}`;
    document.querySelector("#body-count").textContent = `${bodyInput.value.length} / ${bodyInput.maxLength}`;
  }

  async function exportEntries() {
    if (!databaseReady) return;
    exportButton.disabled = true;
    try {
      const currentEntries = await apiRequest("/api/entries");
      const backup = {
        app: "Aru's diary",
        exportedAt: new Date().toISOString(),
        entries: currentEntries
      };
      const file = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const downloadUrl = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `arus-diary-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      showToast("Your diary backup is ready ♡");
    } catch (error) {
      console.error("Unable to export journal entries.", error);
      showToast(`Couldn't create a backup: ${error.message}`);
    } finally {
      exportButton.disabled = !databaseReady;
    }
  }

  function makeAction(label, icon, onClick, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `entry-action ${className}`.trim();
    button.setAttribute("aria-label", label);
    button.title = label;
    button.textContent = icon;
    button.addEventListener("click", onClick);
    return button;
  }

  function makeEntryCard(entry) {
    const card = document.createElement("article");
    card.className = "entry-card";

    const top = document.createElement("div");
    top.className = "entry-card-top";
    const heading = document.createElement("div");
    heading.className = "entry-heading";
    const mood = document.createElement("span");
    mood.className = "entry-mood";
    mood.setAttribute("aria-label", "Mood");
    mood.textContent = entry.mood;
    const title = document.createElement("h3");
    title.className = "entry-title";
    title.textContent = entry.title;
    heading.append(mood, title);

    const actions = document.createElement("div");
    actions.className = "entry-actions";
    actions.append(
      makeAction(entry.favorite ? "Remove from favorites" : "Add to favorites", entry.favorite ? "♥" : "♡", async () => {
        try {
          const updated = await apiRequest(`/api/entries/${encodeURIComponent(entry.id)}/favorite`, {
            method: "PATCH",
            body: JSON.stringify({ favorite: !entry.favorite })
          });
          entries = entries.map((item) => item.id === updated.id ? updated : item);
          render();
        } catch (error) {
          console.error("Unable to update journal favorite.", error);
          showToast(error.message);
        }
      }, entry.favorite ? "is-favorite" : ""),
      makeAction("Edit entry", "✎", () => startEditing(entry)),
      makeAction("Delete entry", "×", () => deleteEntry(entry))
    );
    top.append(heading, actions);

    const date = document.createElement("p");
    date.className = "entry-date";
    date.textContent = formatDate(entry.createdAt);
    const body = document.createElement("p");
    body.className = "entry-body";
    body.textContent = entry.body;
    card.append(top, date, body);
    return card;
  }

  function render() {
    const query = searchInput.value.trim().toLocaleLowerCase();
    const matchingEntries = entries
      .filter((entry) => currentView !== "favorites" || entry.favorite)
      .filter((entry) => !query || `${entry.title} ${entry.body}`.toLocaleLowerCase().includes(query))
      .sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt));

    entryList.replaceChildren(...matchingEntries.map(makeEntryCard));
    const hasEntries = matchingEntries.length > 0;
    emptyState.style.display = hasEntries ? "none" : "flex";
    if (!hasEntries) {
      if (query) {
        emptyTitle.textContent = "No moments found just yet";
        emptyDescription.textContent = "Try another search — your little moments are around here somewhere.";
      } else if (currentView === "favorites") {
        emptyTitle.textContent = "Your favorites will feel right at home";
        emptyDescription.textContent = "Tap the little heart on any entry to keep it close.";
      } else {
        emptyTitle.textContent = "A blank page, full of possibility";
        emptyDescription.textContent = "Your first little moment is waiting to be written. No rush — start whenever it feels right.";
      }
    }
    updateStats();
  }

  function setMood(mood) {
    selectedMood = mood;
    document.querySelectorAll(".mood-button").forEach((button) => {
      const isSelected = button.dataset.mood === mood;
      button.classList.toggle("is-selected", isSelected);
      button.setAttribute("aria-pressed", String(isSelected));
    });
  }

  function resetForm() {
    form.reset();
    editingId = null;
    setMood(moods[0]);
    updateCharacterCounts();
    saveLabel.textContent = "Save this moment";
    cancelButton.hidden = true;
    formMessage.textContent = "";
    document.querySelector("#composer-kicker").textContent = "A FRESH PAGE";
    document.querySelector("#composer-title").textContent = "What's on your mind?";
  }

  function startEditing(entry) {
    editingId = entry.id;
    titleInput.value = entry.title;
    bodyInput.value = entry.body;
    setMood(entry.mood);
    updateCharacterCounts();
    saveLabel.textContent = "Update this moment";
    cancelButton.hidden = false;
    formMessage.textContent = "";
    document.querySelector("#composer-kicker").textContent = "A LITTLE UPDATE";
    document.querySelector("#composer-title").textContent = "Edit this moment";
    document.querySelector("#composer-title").scrollIntoView({ behavior: "smooth", block: "center" });
    titleInput.focus({ preventScroll: true });
  }

  async function deleteEntry(entry) {
    if (!window.confirm(`Delete "${entry.title}"? This can't be undone.`)) return;
    try {
      await apiRequest(`/api/entries/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
      entries = entries.filter((item) => item.id !== entry.id);
      if (editingId === entry.id) resetForm();
      render();
      showToast("Entry gently let go.");
    } catch (error) {
      console.error("Unable to delete journal entry.", error);
      showToast(error.message);
    }
  }

  async function saveEntry(event) {
    event.preventDefault();
    if (!databaseReady) {
      formMessage.textContent = "Your journal is still connecting. Please try again in a moment.";
      return;
    }
    const title = titleInput.value.trim();
    const body = bodyInput.value.trim();
    if (!title || !body) {
      formMessage.textContent = "A little title and a few words are all you need.";
      return;
    }

    const wasEditing = Boolean(editingId);
    saveButton.disabled = true;
    saveLabel.textContent = wasEditing ? "Updating..." : "Saving...";
    try {
      const entry = wasEditing
        ? await apiRequest(`/api/entries/${encodeURIComponent(editingId)}`, {
          method: "PUT",
          body: JSON.stringify({ title, body, mood: selectedMood })
        })
        : await apiRequest("/api/entries", {
          method: "POST",
          body: JSON.stringify({ title, body, mood: selectedMood })
        });
      entries = wasEditing
        ? entries.map((item) => item.id === entry.id ? entry : item)
        : [entry, ...entries];
      resetForm();
      render();
      showToast(wasEditing ? "Your moment has been updated ♡" : "A little moment, lovingly saved ♡");
    } catch (error) {
      console.error("Unable to save journal entry.", error);
      formMessage.textContent = error.message;
    } finally {
      saveButton.disabled = !databaseReady;
      if (editingId) {
        saveLabel.textContent = "Update this moment";
      } else {
        saveLabel.textContent = "Save this moment";
      }
    }
  }

  document.querySelectorAll(".mood-button").forEach((button) => {
    button.addEventListener("click", () => setMood(button.dataset.mood));
  });

  document.querySelectorAll(".nav-link").forEach((button) => {
    button.addEventListener("click", () => {
      currentView = button.dataset.view;
      document.querySelectorAll(".nav-link").forEach((link) => link.classList.toggle("is-active", link === button));
      document.querySelector("#view-label").textContent = currentView === "favorites" ? "favorites" : "all entries";
      document.querySelector("#entries-title").innerHTML = currentView === "favorites"
        ? 'Your favorites <span class="title-sparkle">♡</span>'
        : 'Recent entries <span class="title-sparkle">✧</span>';
      render();
    });
  });

  searchInput.addEventListener("input", render);
  titleInput.addEventListener("input", updateCharacterCounts);
  bodyInput.addEventListener("input", updateCharacterCounts);
  cancelButton.addEventListener("click", resetForm);
  document.querySelector("#start-writing").addEventListener("click", () => titleInput.focus());
  form.addEventListener("submit", saveEntry);
  exportButton.addEventListener("click", exportEntries);

  document.querySelector("#composer-title").textContent = "What's on your mind?";
  todayLabel.textContent = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }).format(new Date());
  updateCharacterCounts();
  saveButton.disabled = true;
  initializeDatabase();
})();