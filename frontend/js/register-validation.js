/* Immediate, accessible validation for public registration. */
const RegistrationValidation = (() => {
    const rules = {
        firstName: { valid: value => Auth.isValidName(value), pending: 'Atención: ingresa tu nombre.', warning: 'Atención: usa al menos 2 letras.', error: 'Error: usa solo letras, espacios, apóstrofes o guiones.' },
        lastName: { valid: value => Auth.isValidName(value), pending: 'Atención: ingresa tu apellido.', warning: 'Atención: usa al menos 2 letras.', error: 'Error: usa solo letras, espacios, apóstrofes o guiones.' },
        rut: { valid: value => Auth.isValidRut(value), pending: 'Atención: ingresa tu RUT.', warning: 'Atención: completa el RUT y su dígito verificador.', error: 'Error: el RUT o su dígito verificador no es válido.' },
        email: { valid: value => /^\S+@\S+\.\S+$/.test(value.trim()), pending: 'Atención: ingresa tu correo.', error: 'Error: ingresa un correo con formato válido.' },
        phone: { valid: value => Boolean(Auth.normalizePhone(value)), pending: 'Atención: ingresa tu celular.', warning: 'Atención: completa los 9 dígitos del celular.', error: 'Error: usa un celular chileno, por ejemplo +56912345678.' },
        password: { valid: value => Auth.isStrongPassword(value), pending: 'Atención: crea una contraseña segura.', warning: 'Atención: faltan requisitos de seguridad.', error: 'Error: usa mínimo 8 caracteres, una letra y un número.' },
        passwordConfirm: { valid: value => value.length > 0 && value === document.getElementById('password').value, pending: 'Atención: repite tu contraseña.', error: 'Error: las contraseñas no coinciden.' }
    };

    function stateFor(input, rule) {
        const value = input.value.trim();
        if (!value) return { state: 'warning', message: rule.pending };
        if (rule.valid(input.value)) return { state: 'success', message: 'Correcto.' };
        if (input.id === 'password' || ((input.id === 'firstName' || input.id === 'lastName') && value.length < 2) || (input.id === 'rut' && value.replace(/[^0-9kK]/g, '').length < 8) || (input.id === 'phone' && value.replace(/\D/g, '').length < 9)) {
            return { state: 'warning', message: rule.warning };
        }
        return { state: 'error', message: rule.error };
    }

    function validate(input) {
        const rule = rules[input.id];
        if (!rule) return true;
        const { state, message } = stateFor(input, rule);
        const feedback = document.querySelector('[data-error-for="' + input.id + '"]');
        input.dataset.validationState = state;
        input.setAttribute('aria-invalid', String(state === 'error'));
        if (feedback) {
            feedback.dataset.status = state;
            feedback.textContent = message;
        }
        return state === 'success';
    }

    function setup() {
        Object.keys(rules).forEach(id => {
            const input = document.getElementById(id);
            if (!input) return;
            input.addEventListener('input', () => {
                validate(input);
                if (id === 'password') {
                    const confirmation = document.getElementById('passwordConfirm');
                    if (confirmation?.value) validate(confirmation);
                }
            });
            input.addEventListener('blur', () => {
                if (id === 'rut') {
                    const normalized = Auth.normalizeRut(input.value);
                    if (normalized) input.value = normalized;
                }
                if (id === 'phone') {
                    const normalized = Auth.normalizePhone(input.value);
                    if (normalized) input.value = normalized;
                }
                validate(input);
            });
        });
    }

    function validateAll() {
        return Object.keys(rules).map(id => validate(document.getElementById(id))).every(Boolean);
    }

    return { setup, validateAll };
})();
