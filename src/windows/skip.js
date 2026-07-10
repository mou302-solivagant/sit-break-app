let remaining = 20;
const countdownEl = document.getElementById('countdown');
const skipBtn = document.getElementById('skipBtn');

window.api.onSkipInit((data) => {
  remaining = data.seconds || 20;
  updateLabel();
  const timer = setInterval(() => {
    remaining -= 1;
    updateLabel();
    if (remaining <= 0) {
      clearInterval(timer);
      window.api.skipTimeout();
    }
  }, 1000);
});

function updateLabel() {
  countdownEl.textContent = `${remaining} 秒後自動鎖定`;
}

skipBtn.addEventListener('click', () => {
  window.api.skipThisTime();
});
