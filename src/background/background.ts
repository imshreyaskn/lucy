// src/background/background.ts

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error: any) => console.error(error));

chrome.commands.onCommand.addListener((command: string) => {
  if (command === 'toggle-listening') {
    chrome.runtime.sendMessage({ type: 'HOTKEY_PRESSED' }).catch(() => {});
  }
});

let previouslyMutedTabIds = new Set<number>();

chrome.runtime.onMessage.addListener((message: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (message.type === 'EXECUTE_BG_ACTION') {
    handleBgAction(message.action).then(sendResponse);
    return true; // async
  }
  
  if (message.type === 'MUTE_ALL_TABS') {
    chrome.tabs.query({}).then(tabs => {
      previouslyMutedTabIds.clear();
      for (const tab of tabs) {
        if (tab.id === undefined) continue;
        if (tab.mutedInfo?.muted) {
          previouslyMutedTabIds.add(tab.id);
        } else {
          chrome.tabs.update(tab.id, { muted: true });
        }
      }
      sendResponse(true);
    });
    return true;
  }

  if (message.type === 'UNMUTE_ALL_TABS') {
    chrome.tabs.query({}).then(tabs => {
      for (const tab of tabs) {
        if (tab.id === undefined) continue;
        if (!previouslyMutedTabIds.has(tab.id)) {
          chrome.tabs.update(tab.id, { muted: false });
        }
      }
      previouslyMutedTabIds.clear();
      sendResponse(true);
    });
    return true;
  }
});

async function handleBgAction(action: any) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;

    if (action.action === 'list_tabs') {
      const allTabs = await chrome.tabs.query({ currentWindow: true });
      const tabList = allTabs.map(t => `[Tab ${t.id}] ${t.title} - ${t.url}`).join('\n');
      return tabList; // Will be sent back to AgentManager as text context!
    }

    if (action.action === 'switch_tab' && action.tab_id) {
      await chrome.tabs.update(action.tab_id, { active: true });
      return true;
    }

    if (action.action === 'close_tab' && action.tab_id) {
      await chrome.tabs.remove(action.tab_id);
      return true;
    }

    if (action.action === 'new_tab') {
      let url = action.url;
      if (url && !url.startsWith('http')) url = 'https://' + url;
      await chrome.tabs.create({ url });
      return true;
    }

    if (!tabId) return false;

    if (action.action === 'navigate') {
      let url = action.url;
      if (!url.startsWith('http')) url = 'https://' + url;
      await chrome.tabs.update(tabId, { url });
      
      await new Promise<void>((resolve) => {
        const listener = (uTabId: number, info: any) => {
          if (uTabId === tabId && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            
            // Inject MutationObserver wait script for 500ms DOM silence
            chrome.scripting.executeScript({
              target: { tabId },
              func: () => {
                return new Promise<void>(res => {
                  let timer: ReturnType<typeof setTimeout>;
                  const observer = new MutationObserver(() => {
                    clearTimeout(timer);
                    timer = setTimeout(() => { observer.disconnect(); res(); }, 500);
                  });
                  observer.observe(document.body, { childList: true, subtree: true });
                  timer = setTimeout(() => { observer.disconnect(); res(); }, 500);
                });
              }
            }).then(() => resolve()).catch(() => resolve());
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }, 10000);
      });
      
      return true;
    }

    if (action.action === 'go_back') {
      await chrome.tabs.goBack(tabId).catch(() => {});
      return true;
    }

    return false;
  } catch (err) {
    console.error('[Voice Agent] BG action failed:', err);
    return false;
  }
}
