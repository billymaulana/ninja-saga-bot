(() => {
  const send = (message) => {
    try {
      chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
      return true;
    } catch (e) {
      return false;
    }
  };

  const timer = setInterval(() => {
    if (!send({ type: 'devCheck' })) clearInterval(timer);
  }, 2000);
  send({ type: 'devCheck', fresh: true });

  /*
   * bot.js runs in the page's main world without chrome.runtime, so it announces Start/Stop with
   * window.postMessage and this isolated script relays it to the background worker.
   */
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'nsBot') return;
    if (event.data.type === 'start' || event.data.type === 'stop') send({ type: `bot-${event.data.type}` });
    else if (event.data.type === 'telemetry') send({ type: 'telemetry', data: event.data.data });
  });
})();
