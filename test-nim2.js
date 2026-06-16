fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
  method:'POST', 
  headers:{
    Authorization: 'Bearer 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', 
    'Content-Type': 'application/json'
  }, 
  body: JSON.stringify({
    model:'meta/llama-3.1-70b-instruct', 
    messages:[{role:'user',content:'output valid json like {"test": 123}'}], 
    temperature: 0.1, 
    response_format: {type: 'json_object'}
  })
}).then(r=>r.text()).then(console.log);
