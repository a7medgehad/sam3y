function t(key) { return chrome.i18n.getMessage(key) || key; }

async function getState() {
  const { globalEnabled = false, tabEnabled = {}, profile = 'balanced' } = await chrome.storage.local.get({ globalEnabled: false, tabEnabled: {}, profile: 'balanced' });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentTabEnabled = !!tabEnabled[tab?.id];
  return { globalEnabled, currentTabEnabled, profile };
}

function renderState(state) {
  const toggleTab = document.getElementById('toggleTab');
  const toggleGlobal = document.getElementById('toggleGlobal');
  const profile = document.getElementById('profile');
  const status = document.getElementById('status');

  toggleTab.textContent = state.currentTabEnabled ? t('popupDisable') : t('popupEnable');
  toggleTab.classList.toggle('enabled', state.currentTabEnabled);

  toggleGlobal.textContent = state.globalEnabled ? t('popupDisable') : t('popupEnable');
  toggleGlobal.classList.toggle('enabled', state.globalEnabled);

  profile.value = state.profile;

  status.textContent = `Profile: ${state.profile} | Global: ${state.globalEnabled ? 'on' : 'off'}`;
}

async function init() {
  document.getElementById('subtitle').textContent = t('extDescription');
  document.getElementById('currentTabLabel').textContent = t('popupCurrentTab');
  document.getElementById('globalLabel').textContent = t('popupGlobal');
  document.getElementById('profileLabel').textContent = t('popupProfile');
  document.querySelector('#profile option[value="fast"]').textContent = t('profileFast');
  document.querySelector('#profile option[value="balanced"]').textContent = t('profileBalanced');
  document.querySelector('#profile option[value="best"]').textContent = t('profileBest');

  renderState(await getState());

  document.getElementById('toggleTab').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'sam3y:toggle-current-tab' });
    renderState(await getState());
  });
  document.getElementById('toggleGlobal').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'sam3y:toggle-global' });
    renderState(await getState());
  });
  document.getElementById('profile').addEventListener('change', async (e) => {
    await chrome.runtime.sendMessage({ type: 'sam3y:set-profile', profile: e.target.value });
    renderState(await getState());
  });
}

document.addEventListener('DOMContentLoaded', init);

