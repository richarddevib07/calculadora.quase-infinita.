
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const expressionEl = $("expression");
  const resultEl = $("result");
  const resultMeta = $("resultMeta");
  const historyEl = $("history");
  let history = [];
  let lastValue = new Decimal(0);

  const setPrecision = () => {
    Decimal.set({ precision: Number($("precision").value), rounding: Decimal.ROUND_HALF_UP, toExpNeg: -12, toExpPos: 30 });
    $("precisionLabel").textContent = `${$("precision").value} dígitos`;
  };
  setPrecision();

  function tokenize(input) {
    const s = input.replace(/π/g, "pi").replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
    const tokens = [];
    let i = 0;
    while (i < s.length) {
      if (/\s/.test(s[i])) { i++; continue; }
      const rest = s.slice(i);
      const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
      const ident = rest.match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
      if (number) { tokens.push({ type: "number", value: number[0] }); i += number[0].length; continue; }
      if (ident) { tokens.push({ type: "ident", value: ident[0].toLowerCase() }); i += ident[0].length; continue; }
      if ("+-*/^()%!".includes(s[i])) { tokens.push({ type: s[i], value: s[i] }); i++; continue; }
      throw new Error(`Caractere não reconhecido: "${s[i]}"`);
    }
    tokens.push({ type: "eof", value: "" });
    return tokens;
  }

  function factorial(x) {
    if (!x.isInteger() || x.isNegative()) throw new Error("Fatorial exige um inteiro não negativo.");
    if (x.gt(100000)) throw new Error("Fatorial acima de 100.000 foi bloqueado para proteger o navegador.");
    const n = x.toNumber();
    let out = 1n;
    for (let k = 2n; k <= BigInt(n); k++) out *= k;
    return new Decimal(out.toString());
  }

  function parse(input) {
    const tokens = tokenize(input);
    let pos = 0;
    const peek = () => tokens[pos];
    const take = (type) => {
      if (peek().type !== type) throw new Error(`Esperado "${type}", encontrado "${peek().value || "fim da expressão"}".`);
      return tokens[pos++];
    };
    const functions = new Set(["sqrt","cbrt","sin","cos","tan","asin","acos","atan","ln","log","abs","floor","ceil","round","exp"]);
    function primary() {
      let t = peek();
      let value;
      if (t.type === "number") { pos++; value = new Decimal(t.value); }
      else if (t.type === "ident") {
        pos++;
        if (t.value === "pi") value = Decimal.acos(-1);
        else if (t.value === "e") value = Decimal.exp(1);
        else if (functions.has(t.value)) {
          take("(");
          const arg = addSub();
          take(")");
          value = applyFunction(t.value, arg);
        } else throw new Error(`Nome desconhecido: ${t.value}`);
      } else if (t.type === "(") {
        pos++; value = addSub(); take(")");
      } else if (t.type === "+") { pos++; return unary(); }
      else if (t.type === "-") { pos++; return unary().neg(); }
      else throw new Error(`Expressão inesperada: "${t.value || "fim"}"`);
      while (peek().type === "!" || peek().type === "%") {
        const op = tokens[pos++].type;
        value = op === "!" ? factorial(value) : value.div(100);
      }
      return value;
    }
    function unary() { return primary(); }
    function power() {
      let left = primary();
      if (peek().type === "^") {
        pos++;
        const right = unary();
        if (!right.isInteger() && left.isNegative()) throw new Error("Expoente decimal de base negativa não é suportado.");
        if (right.abs().gt(1000000)) throw new Error("Expoente acima de 1.000.000 não é permitido.");
        left = left.pow(right);
      }
      return left;
    }
    function multiply() {
      let v = power();
      while (["*","/"].includes(peek().type)) {
        const op = tokens[pos++].type, r = power();
        if (op === "/" && r.isZero()) throw new Error("Não é possível dividir por zero.");
        v = op === "*" ? v.mul(r) : v.div(r);
      }
      return v;
    }
    function addSub() {
      let v = multiply();
      while (["+", "-"].includes(peek().type)) {
        const op = tokens[pos++].type, r = multiply();
        v = op === "+" ? v.add(r) : v.sub(r);
      }
      return v;
    }
    const value = addSub();
    if (peek().type !== "eof") throw new Error(`Trecho inesperado: "${peek().value}"`);
    return value;
  }

  function applyFunction(name, x) {
    const asNumber = () => {
      if (!x.abs().lte(1e15)) throw new Error("Esta função trigonométrica exige argumento com módulo até 10¹⁵.");
      return x.toNumber();
    };
    switch (name) {
      case "sqrt": if (x.isNegative()) throw new Error("Raiz quadrada de número negativo não é real."); return x.sqrt();
      case "cbrt": return x.isNegative() ? x.neg().pow(new Decimal(1).div(3)).neg() : x.pow(new Decimal(1).div(3));
      case "sin": return new Decimal(Math.sin(asNumber()));
      case "cos": return new Decimal(Math.cos(asNumber()));
      case "tan": return new Decimal(Math.tan(asNumber()));
      case "asin": return new Decimal(Math.asin(asNumber()));
      case "acos": return new Decimal(Math.acos(asNumber()));
      case "atan": return new Decimal(Math.atan(asNumber()));
      case "ln": if (x.lte(0)) throw new Error("ln exige um número positivo."); return x.ln();
      case "log": if (x.lte(0)) throw new Error("log exige um número positivo."); return x.log(10);
      case "abs": return x.abs();
      case "floor": return x.floor();
      case "ceil": return x.ceil();
      case "round": return x.toDecimalPlaces(0);
      case "exp": return x.exp();
      default: throw new Error("Função não disponível.");
    }
  }

  function format(value) {
    const mode = $("format").value;
    if (mode === "scientific") return value.toExponential();
    if (mode === "normal") return value.toFixed(Math.min(Decimal.precision, 1000)).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    return value.toString();
  }

  function calculate() {
    const input = expressionEl.value.trim();
    if (!input) return;
    try {
      const value = parse(input);
      lastValue = value;
      const output = format(value);
      resultEl.classList.remove("error");
      resultEl.textContent = output;
      resultMeta.textContent = `${value.sd()} dígitos significativos • ${value.isFinite() ? "resultado finito" : "resultado não finito"}`;
      history.unshift({ input, output });
      history = history.slice(0, 100);
      renderHistory();
    } catch (err) {
      resultEl.classList.add("error");
      resultEl.textContent = err.message || "Não foi possível calcular.";
      resultMeta.textContent = "Verifique a expressão e tente novamente.";
    }
  }

  function renderHistory() {
    if (!history.length) {
      historyEl.className = "history-empty";
      historyEl.textContent = "Seus cálculos aparecerão aqui enquanto esta página estiver aberta.";
      return;
    }
    historyEl.className = "";
    historyEl.replaceChildren();
    history.forEach((item) => {
      const row = document.createElement("div");
      row.className = "history-item";
      const expr = document.createElement("div"); expr.className = "history-expression"; expr.textContent = item.input;
      const res = document.createElement("div"); res.className = "history-result"; res.textContent = "= " + item.output;
      row.append(expr, res);
      row.addEventListener("click", () => { expressionEl.value = item.input; calculate(); });
      historyEl.append(row);
    });
  }

  function insertAtCursor(text) {
    const start = expressionEl.selectionStart, end = expressionEl.selectionEnd;
    expressionEl.setRangeText(text, start, end, "end");
    expressionEl.focus();
  }

  $("keypad").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.action === "clear") { expressionEl.value = ""; resultEl.textContent = "0"; resultEl.classList.remove("error"); resultMeta.textContent = "Aguardando cálculo"; }
    else if (button.dataset.action === "backspace") {
      const a = expressionEl.selectionStart, b = expressionEl.selectionEnd;
      if (a !== b) expressionEl.setRangeText("", a, b, "end");
      else if (a > 0) expressionEl.setRangeText("", a - 1, a, "end");
      expressionEl.focus();
    } else if (button.dataset.action === "calculate") calculate();
    else if (button.dataset.insert) insertAtCursor(button.dataset.insert);
  });
  document.querySelectorAll("[data-insert]").forEach((button) => {
    if (button.closest("#keypad")) return;
    button.addEventListener("click", () => insertAtCursor(button.dataset.insert));
  });
  expressionEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); calculate(); }
  });
  $("precision").addEventListener("change", () => { setPrecision(); });
  $("format").addEventListener("change", () => { if (expressionEl.value.trim()) calculate(); });
  $("clearHistory").addEventListener("click", () => { history = []; renderHistory(); });
  $("copyResult").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(lastValue.toString()); $("copyResult").textContent = "Copiado!"; }
    catch { $("copyResult").textContent = "Cópia indisponível"; }
    setTimeout(() => $("copyResult").textContent = "Copiar resultado", 1400);
  });
})();
