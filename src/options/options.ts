const grantBtn = document.getElementById('grant-btn') as HTMLButtonElement;
const statusText = document.getElementById('status')!;

grantBtn.addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop());
    statusText.textContent = "Permission Granted! You can close this tab and use the side panel.";
    statusText.style.color = "#4ade80"; // green
  } catch (err) {
    console.error(err);
    statusText.textContent = "Permission Denied. Please check Chrome settings.";
    statusText.style.color = "#ef4444"; // red
  }
});
