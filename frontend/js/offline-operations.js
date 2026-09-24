(function(){
  const DB='tshow-operational-cache-v1', STORE='snapshots';
  function open(){return new Promise((resolve,reject)=>{if(!indexedDB)return reject(new Error('IndexedDB no disponible'));const request=indexedDB.open(DB,1);request.onupgradeneeded=()=>request.result.createObjectStore(STORE);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
  async function save(key,value){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put({savedAt:new Date().toISOString(),value},key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
  async function read(key){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly');const request=tx.objectStore(STORE).get(key);request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error);});}
  async function remove(key){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
  async function saveDraft(key,value){return save(`draft:${key}`,{draftedAt:new Date().toISOString(),value});}
  async function readDraft(key){const row=await read(`draft:${key}`);return row?.value||null;}
  async function clearUser(userId){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');const request=tx.objectStore(STORE).openCursor();request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;const key=String(cursor.key);if(key.startsWith(`${userId}:`)||key.startsWith(`draft:${userId}:`))cursor.delete();cursor.continue();};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
  window.TShowOffline={save,read,remove,saveDraft,readDraft,clearUser};
})();
