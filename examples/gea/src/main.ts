import App from "./app"
import "./styles.css"

const root = document.getElementById("app")
if (!root) throw new Error("#app not found")

new App().render(root)
