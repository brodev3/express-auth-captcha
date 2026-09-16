/* global document, HTMLButtonElement, HTMLFormElement, HTMLInputElement, HTMLElement */

(() => {
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const USERNAME_PATTERN = /^[A-Za-z0-9]+$/;
  const CAPTCHA_PATTERN = /^[0-9]+$/;

  for (const form of document.querySelectorAll("[data-validation]")) {
    if (!(form instanceof HTMLFormElement)) {
      continue;
    }

    form.noValidate = true;
    form.addEventListener("input", (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement) {
        clearFieldError(form, target.name);
      }
    });

    form.addEventListener("submit", (event) => {
      clearErrors(form);

      const errors = form.dataset.validation === "register"
        ? validateRegister(form)
        : validateLogin(form);

      if (errors.length === 0) {
        const submitButton = form.querySelector('button[type="submit"]');
        if (submitButton instanceof HTMLButtonElement) {
          submitButton.disabled = true;
        }
        return;
      }

      event.preventDefault();
      for (const error of errors) {
        setFieldError(form, error.field, error.message);
      }

      const firstInvalid = form.querySelector('[aria-invalid="true"]');
      if (firstInvalid instanceof HTMLElement) {
        firstInvalid.focus();
      }
    });
  }

  function validateRegister(form) {
    const username = readValue(form, "username").trim();
    const email = readValue(form, "email").trim();
    const password = readValue(form, "password");
    const passwordConfirmation = readValue(form, "passwordConfirmation");
    const captchaAnswer = readValue(form, "captchaAnswer");
    const errors = [];

    if (!username) {
      errors.push({ field: "username", message: "Введите имя пользователя" });
    } else if (username.length < 3 || username.length > 20) {
      errors.push({ field: "username", message: "Имя пользователя должно содержать от 3 до 20 символов" });
    } else if (!USERNAME_PATTERN.test(username)) {
      errors.push({ field: "username", message: "Имя пользователя должно содержать только латинские буквы и цифры" });
    }

    if (!email) {
      errors.push({ field: "email", message: "Введите email" });
    } else if (email.length > 100) {
      errors.push({ field: "email", message: "Email не должен превышать 100 символов" });
    } else if (!EMAIL_PATTERN.test(email)) {
      errors.push({ field: "email", message: "Введите корректный email" });
    }

    validatePassword(password, errors);

    if (!passwordConfirmation) {
      errors.push({ field: "passwordConfirmation", message: "Подтвердите пароль" });
    } else if (passwordConfirmation !== password) {
      errors.push({ field: "passwordConfirmation", message: "Пароли не совпадают" });
    }

    validateCaptcha(captchaAnswer, errors);
    return errors;
  }

  function validateLogin(form) {
    const login = readValue(form, "login").trim();
    const password = readValue(form, "password");
    const captchaAnswer = readValue(form, "captchaAnswer");
    const errors = [];

    if (!login) {
      errors.push({ field: "login", message: "Введите логин" });
    } else if (login.length > 100) {
      errors.push({ field: "login", message: "Логин не должен превышать 100 символов" });
    }

    if (!password) {
      errors.push({ field: "password", message: "Введите пароль" });
    }

    validateCaptcha(captchaAnswer, errors);
    return errors;
  }

  function validatePassword(password, errors) {
    if (!password) {
      errors.push({ field: "password", message: "Введите пароль" });
      return;
    }

    if (password.length < 6 || password.length > 128) {
      errors.push({ field: "password", message: "Пароль должен содержать от 6 до 128 символов" });
      return;
    }

    if (containsControlCharacters(password)) {
      errors.push({ field: "password", message: "Пароль содержит недопустимые символы" });
      return;
    }

    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      errors.push({ field: "password", message: "Пароль должен содержать латинскую букву и цифру" });
    }
  }

  function validateCaptcha(answer, errors) {
    if (!answer) {
      errors.push({ field: "captchaAnswer", message: "Введите ответ CAPTCHA" });
    } else if (!CAPTCHA_PATTERN.test(answer)) {
      errors.push({ field: "captchaAnswer", message: "Ответ CAPTCHA должен содержать только цифры" });
    }
  }

  function containsControlCharacters(value) {
    for (const character of value) {
      const codePoint = character.codePointAt(0);
      if (codePoint !== undefined && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))) {
        return true;
      }
    }

    return false;
  }

  function readValue(form, name) {
    const field = form.elements.namedItem(name);
    return field instanceof HTMLInputElement ? field.value : "";
  }

  function clearErrors(form) {
    for (const field of form.querySelectorAll("input[name]")) {
      if (field instanceof HTMLInputElement) {
        clearFieldError(form, field.name);
      }
    }
  }

  function clearFieldError(form, fieldName) {
    const field = form.elements.namedItem(fieldName);
    if (field instanceof HTMLInputElement) {
      field.setAttribute("aria-invalid", "false");
    }

    const error = document.getElementById(`${fieldName}-error`);
    if (error && form.contains(error)) {
      error.textContent = "";
      error.hidden = true;
    }
  }

  function setFieldError(form, fieldName, message) {
    const field = form.elements.namedItem(fieldName);
    if (field instanceof HTMLInputElement) {
      field.setAttribute("aria-invalid", "true");
    }

    const error = document.getElementById(`${fieldName}-error`);
    if (error && form.contains(error)) {
      error.textContent = message;
      error.hidden = false;
    }
  }
})();
