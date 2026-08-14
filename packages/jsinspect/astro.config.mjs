import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
	server: { port: 3000 },
	integrations: [react()],
	vite: {
		plugins: [tailwindcss()],
	},
});
