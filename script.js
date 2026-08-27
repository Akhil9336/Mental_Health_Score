'use strict';

/* ============================================================
   Config — must match the FastAPI Pydantic model exactly
   ============================================================ */
const API_URL = 'https://mental-health-score-cuau.onrender.com/predict';
const API_ROOT = 'https://mental-health-score-cuau.onrender.com/';

// field -> { type, min, max } used for client-side validation + coercion
const FIELD_SPEC = {
  age:                       { type: 'int',   min: 21, max: 100 },
  gender:                    { type: 'str' },
  country:                   { type: 'str' },
  academic_level:            { type: 'str' },
  most_used_platform:        { type: 'str' },
  purpose_of_use:            { type: 'str' },
  avg_daily_usage_hours:     { type: 'float', min: 0,  max: 24 },
  daily_unlocks:             { type: 'int',   min: 0 },
  study_hours:               { type: 'float', min: 0,  max: 24 },
  physical_activity_hours:  { type: 'float', min: 0,  max: 24 },
  sleep_hours_per_night:    { type: 'float', min: 0,  max: 24 },
  stress_level:              { type: 'str' },
};

const RING_CIRCUMFERENCE = 552.92; // 2 * PI * r(88)
const RING_MAX = 100; // purely visual scale for the ring; the real number is always shown as-is

/* ============================================================
   DOM refs
   ============================================================ */
const form        = document.getElementById('predictForm');
const submitBtn    = document.getElementById('submitBtn');
const resetBtn      = document.getElementById('resetBtn');
const formMsg       = document.getElementById('formMsg');
const apiStatus     = document.getElementById('apiStatus');
const apiUrlLabel   = document.getElementById('apiUrlLabel');

const ringWrap   = document.querySelector('.ring-wrap');
const ringFill   = document.getElementById('ringFill');
const ringValue  = document.getElementById('ringValue');

const stateIdle    = document.getElementById('stateIdle');
const stateLoading = document.getElementById('stateLoading');
const stateError   = document.getElementById('stateError');
const stateResult  = document.getElementById('stateResult');
const errorText    = document.getElementById('errorText');

apiUrlLabel.textContent = API_URL;

/* ============================================================
   API health check (informational, non-blocking)
   ============================================================ */
async function checkApiHealth(){
  try{
    const res = await fetch(API_ROOT, { method: 'GET' });
    if (!res.ok) throw new Error('bad status');
    apiStatus.textContent = 'API connected';
    apiStatus.classList.add('is-online');
    apiStatus.classList.remove('is-offline');
  } catch (e){
    apiStatus.textContent = 'API unreachable';
    apiStatus.classList.add('is-offline');
    apiStatus.classList.remove('is-online');
  }
}
checkApiHealth();

/* ============================================================
   Helpers
   ============================================================ */
function clearFieldErrors(){
  form.querySelectorAll('.field').forEach(f => f.classList.remove('has-error'));
  form.querySelectorAll('.field__error').forEach(e => e.textContent = '');
  formMsg.textContent = '';
}

function setFieldError(name, message){
  const field = document.getElementById(name)?.closest('.field');
  const errEl = document.getElementById(`err-${name}`);
  if (field) field.classList.add('has-error');
  if (errEl) errEl.textContent = message;
}

/**
 * Reads the raw form, validates every field against FIELD_SPEC,
 * and returns { valid, payload } — payload has correctly-typed values.
 */
function readAndValidateForm(){
  clearFieldErrors();
  let valid = true;
  const payload = {};

  for (const [name, spec] of Object.entries(FIELD_SPEC)){
    const el = document.getElementById(name);
    const raw = el.value;

    if (raw === '' || raw === null){
      setFieldError(name, 'This field is required.');
      valid = false;
      continue;
    }

    if (spec.type === 'int' || spec.type === 'float'){
      const num = Number(raw);
      if (Number.isNaN(num)){
        setFieldError(name, 'Enter a valid number.');
        valid = false;
        continue;
      }
      if (spec.type === 'int' && !Number.isInteger(num)){
        setFieldError(name, 'Whole numbers only.');
        valid = false;
        continue;
      }
      if (spec.min !== undefined && num < spec.min){
        setFieldError(name, `Must be ${spec.min} or higher.`);
        valid = false;
        continue;
      }
      if (spec.max !== undefined && num > spec.max){
        setFieldError(name, `Must be ${spec.max} or lower.`);
        valid = false;
        continue;
      }
      payload[name] = spec.type === 'int' ? parseInt(num, 10) : num;
    } else {
      // Literal / plain string fields — required + trimmed
      const val = String(raw).trim();
      if (!val){
        setFieldError(name, 'This field is required.');
        valid = false;
        continue;
      }
      payload[name] = val;
    }
  }

  return { valid, payload };
}

/* ============================================================
   Result panel state machine
   ============================================================ */
function showState(which){
  stateIdle.hidden    = which !== 'idle';
  stateLoading.hidden = which !== 'loading';
  stateError.hidden   = which !== 'error';
  stateResult.hidden  = which !== 'result';

  ringWrap.classList.toggle('is-loading', which === 'loading');
  if (which !== 'result') ringValue.textContent = '';
}

function resetRing(){
  ringFill.style.strokeDashoffset = String(RING_CIRCUMFERENCE);
  ringValue.textContent = '';
}

function updateRing(score){
  const clamped = Math.max(0, Math.min(RING_MAX, score));
  const fraction = clamped / RING_MAX;
  const offset = RING_CIRCUMFERENCE * (1 - fraction);
  ringFill.style.strokeDashoffset = String(offset);
  ringValue.textContent = score.toFixed(2);
}

/* ============================================================
   Submit
   ============================================================ */
form.addEventListener('submit', async (evt) => {
  evt.preventDefault();

  const { valid, payload } = readAndValidateForm();
  if (!valid){
    formMsg.textContent = 'Please fix the highlighted fields before submitting.';
    return;
  }

  submitBtn.disabled = true;
  resetBtn.disabled = true;
  resetRing();
  showState('loading');

  try{
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok){
      let detail = `Server responded with status ${response.status}.`;
      try{
        const errBody = await response.json();
        if (errBody?.detail){
          detail = Array.isArray(errBody.detail)
            ? errBody.detail.map(d => `${(d.loc || []).slice(-1)[0] || 'field'}: ${d.msg}`).join(' — ')
            : String(errBody.detail);
        }
      } catch(_){ /* body wasn't JSON — keep generic message */ }

      throw new Error(detail);
    }

    const data = await response.json();

    if (typeof data.predicted_mental_health_score !== 'number'){
      throw new Error('The API response did not include predicted_mental_health_score.');
    }

    updateRing(data.predicted_mental_health_score);
    showState('result');

  } catch (err){
    let message;
    if (err.name === 'AbortError'){
      message = 'The request timed out. Is the FastAPI server still running?';
    } else if (err instanceof TypeError){
      message = `Could not reach the API at ${API_URL}. Check that uvicorn is running and CORS is enabled.`;
    } else {
      message = err.message || 'An unexpected error occurred.';
    }
    errorText.textContent = message;
    resetRing();
    showState('error');
  } finally {
    submitBtn.disabled = false;
    resetBtn.disabled = false;
  }
});

/* ============================================================
   Reset
   ============================================================ */
resetBtn.addEventListener('click', () => {
  form.reset();
  clearFieldErrors();
  resetRing();
  showState('idle');
});

/* init */
resetRing();
showState('idle');
