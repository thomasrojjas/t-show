/* Immediate, accessible validation for public registration. */
const RegistrationValidation = (() => {
    const rules = {
        firstName: { valid: value => Auth.isValidName(value), message: 'Usa solo letras; mínimo 2 caracteres.' },
        lastName: { valid: value => Auth.isValidName(value), message: 'Usa solo letras; mínimo 2 caracteres.' },
        rut: { valid: value => Auth.isValidRut(value), message: 'RUT inválido. Revisa el dígito verificador.' },
        email: { valid: value => /^\S+@\S+\.\S+$/.test(value.trim()), message: 'Ingresa un correo válido.' },
        phone: { valid: value => Boolean(Auth.normalizePhone(value)), message: 'Usa un celular chileno: +56912345678.' },
        password: { valid: value => Auth.isStrongPassword(value), message: 'Mínimo 10 caracteres, mayúscula, minúscula y número.' },
        passwordConfirm: { valid: value => value.length > 0 && value === document.getElementById('password').value, message: 'Las contraseñas no coinciden.' }
    };
    function validate(input) {
        const rule = rules[input.id]; if (!rule) return true;
        const valid = rule.valid(input.value); const error = document.querySelector(`[data-error-for="${input.id}"]`);
        input.setAttribute('aria-invalid', String(!valid));
        if (error) error.textContent = valid || !input.value ? '' : rule.message;
        return valid;
    }
    function setup() {
        Object.keys(rules).forEach(id => {
            const input = document.getElementById(id); if (!input) return;
            input.addEventListener('input', () => {
                validate(input);
                if (id === 'password') {
                    const confirmation = document.getElementById('passwordConfirm');
                    if (confirmation?.value) validate(confirmation);
                }
            });
            input.addEventListener('blur', () => {
                if (id === 'rut') { const normalized = Auth.normalizeRut(input.value); if (normalized) input.value = normalized; }
                if (id === 'phone') { const normalized = Auth.normalizePhone(input.value); if (normalized) input.value = normalized; }
                validate(input);
            });
        });
    }
    function validateAll() { return Object.keys(rules).map(id => validate(document.getElementById(id))).every(Boolean); }
    return { setup, validateAll };
})();
