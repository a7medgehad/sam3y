async function load() {
  const { profile = 'balanced', onDeviceOnly = true } = await chrome.storage.local.get({ profile: 'balanced', onDeviceOnly: true });
  document.getElementById('defaultProfile').value = profile;
  document.getElementById('onDeviceOnly').checked = !!onDeviceOnly;
}

async function save() {
  const profile = document.getElementById('defaultProfile').value;
  const onDeviceOnly = document.getElementById('onDeviceOnly').checked;
  await chrome.storage.local.set({ profile, onDeviceOnly });
  document.getElementById('status').textContent = 'تم الحفظ';
  setTimeout(() => (document.getElementById('status').textContent = ''), 1200);
}

document.addEventListener('DOMContentLoaded', () => {
  load();
  document.getElementById('save').addEventListener('click', save);
});

