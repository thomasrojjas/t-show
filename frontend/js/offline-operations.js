(function(){
  const DB='tshow-operational-cache-v1', STORE='snapshots';
  function open(){return new Promise((resolve,reject)=>{if(!indexedDB)return reject(new Error('IndexedDB no disponible'));const request=indexedDB.open(DB,1);request.onupgradeneeded=()=>request.result.createObjectStore(STORE);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
  async function save(key,value){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put({savedAt:new Date().toISOString(),value},key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
  async function read(key){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly');const request=tx.objectStore(STORE).get(key);request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error);});}
  window.TShowOffline={save,read};
})();
