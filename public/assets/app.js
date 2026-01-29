const statusEl = document.getElementById("status");
const resultContent = document.getElementById("resultContent");
const checkedAtEl = document.getElementById("checkedAt");
const codeForm = document.getElementById("codeForm");
const emailInput = document.getElementById("email");
const passwordRow = document.getElementById("passwordRow");
const passwordInput = document.getElementById("password");

function setStatus(text, type) {
  statusEl.textContent = text;
  statusEl.classList.remove("error", "success");
  if (type) {
    statusEl.classList.add(type);
  }
}

function setCheckedAt(checkedAt) {
  checkedAtEl.textContent = checkedAt
    ? `Checked at ${new Date(checkedAt).toLocaleTimeString()}`
    : "";
}

function itemTimestamp(item) {
  if (item.timestamp) {
    return Number(item.timestamp) * 1000;
  }
  if (item.time) {
    const parsed = Date.parse(item.time);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function createRow(item) {
  const row = document.createElement("div");
  row.className = "result-row";

  const meta = document.createElement("div");
  meta.className = "result-meta";
  const time = item.time ? new Date(item.time).toLocaleString() : "Unknown time";
  meta.textContent = `${time} | ${item.from || "Unknown sender"}`;

  const code = document.createElement("div");
  code.className = "result-code";
  code.textContent = item.code;

  row.appendChild(meta);
  row.appendChild(code);
  return row;
}

function renderList(items, container) {
  const list = document.createElement("div");
  list.className = "result-list";
  items.forEach((item) => list.appendChild(createRow(item)));
  container.appendChild(list);
}

function renderEmpty(message) {
  resultContent.textContent = message;
}

function setPasswordVisibility(show) {
  passwordRow.classList.toggle("hidden", !show);
}

async function refreshAuthStatus() {
  try {
    const response = await fetch("/api/auth/status");
    const data = await response.json();
    if (data.authenticated) {
      setStatus(data.message || "IMAP connected. Ready to search.", "success");
    } else {
      setStatus(data.message || "IMAP not configured.", "error");
    }
  } catch {
    setStatus("Unable to check authentication status.", "error");
  }
}

async function fetchCodes() {
  resultContent.replaceChildren();
  setCheckedAt("");
  setStatus("Searching the lookback window...", "");

  try {
    const params = new URLSearchParams({ email: emailInput.value });
    if (passwordInput.value) {
      params.set("password", passwordInput.value);
    }
    const response = await fetch(`/api/codes?${params.toString()}`);
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || "Something went wrong.", "error");
      return;
    }

    setStatus("Codes retrieved.", "success");
    setCheckedAt(data.checkedAt);

    const items = (data.items || []).slice().sort((a, b) => itemTimestamp(b) - itemTimestamp(a));
    const lockedItems = data.unlocked
      ? (data.lockedItems || []).slice().sort((a, b) => itemTimestamp(b) - itemTimestamp(a))
      : [];
    const shouldShowPassword = (data.lockedCount || 0) > 0 || lockedItems.length > 0;
    setPasswordVisibility(shouldShowPassword);

    const hasVisible = items.length || lockedItems.length;
    if (!hasVisible) {
      if (data.lockedCount && !data.unlocked) {
        renderEmpty("No public codes found. Enter the group password to view protected codes.");
      } else {
        renderEmpty("No codes found in the lookback window.");
      }
      return;
    }

    if (items.length) {
      renderList(items, resultContent);
    }
    if (data.lockedCount && !data.unlocked) {
      const note = document.createElement("div");
      note.className = "locked-note";
      note.textContent = `${data.lockedCount} protected code(s) available. Enter the group password to view.`;
      resultContent.appendChild(note);
    }
    if (lockedItems.length) {
      const label = document.createElement("div");
      label.className = "locked-label";
      label.textContent = "Protected codes";
      resultContent.appendChild(label);
      renderList(lockedItems, resultContent);
    }
  } catch {
    setStatus("Unable to reach the server.", "error");
  }
}

codeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  fetchCodes();
});

refreshAuthStatus();
