# EventTime Pro v4.0 - Plataforma Avanzada de Timing

Plataforma profesional para la gestión de cronogramas de producción, escaletas en vivo, cálculo matemático de tiempos y generación de minutas de transmisión y eventos masivos.

Repositorio: [https://github.com/grmedios/Timming.git](https://github.com/grmedios/Timming.git)

---

## 🚀 Estructura del Proyecto

El proyecto está modularizado en Frontend desacoplado y Backend REST API con persistencia local:

```
timming/
├── .gitignore
├── README.md
├── start.bat                   # Lanzador rápido de 1 clic para Windows
├── start.ps1                   # Script de inicio PowerShell
├── backend/
│   ├── package.json            # Dependencias del servidor Node.js
│   ├── server.js               # Servidor REST API + Servidor de archivos estáticos
│   ├── routes/
│   │   └── projects.js         # Endpoints CRUD de proyectos
│   └── data/
│       └── projects.json       # Base de datos persistente en disco
└── frontend/
    ├── index.html              # Landing pública
    ├── app.html                # Planificador protegido
    ├── css/
    │   ├── main.css            # Sistema de diseño, temas y controles
    │   ├── timeline.css        # Barra de cronograma interactiva y visual
    │   └── print.css           # Estilos de impresión y exportación A4 multipágina
    └── js/
        ├── app.js              # Controlador principal y enlace de eventos
        ├── timing-engine.js    # Motor de cálculo matemático de horarios y duraciones
        ├── blocks-manager.js   # Gestión de bloques dinámicos y Drag & Drop
        ├── api-client.js       # Cliente HTTP con sincronización y fallback LocalStorage
        └── print-export.js     # Notificaciones Toast, exportación JSON y PDF
```

---

## ⚙️ Características Principales

1. **Gestión de Horarios Globales**:
   - **Segmento 1 (Convocatoria)**: Hora de reunión técnica / comisiones y duración en minutos.
   - **Segmento 2 (Apertura de Puertas)**: Hora de apertura y tiempo de DJ/Ambientación previa.
   - **Segmento 3 (Inicio de Show)**: Modo *Automático* (calculado al concluir puertas) o *Manual* (hora personalizada).

2. **Gestor de Bloques & Escaleta en Tiempo Real**:
   - Soporte de bloques: **SHOW**, **ANIMACIÓN**, **PREPARACIÓN**, **OTRO/PROTOCOLO**.
   - Configuración de duración por bloque y tiempo adicional de **Bis / Encore** para Shows.
   - Reordenamiento intuitivo mediante **Drag & Drop** o botones de posición (▲ / ▼).

3. **Métricas en Vivo & Barra de Cronograma**:
   - Tarjetas de métricas: Convocatoria, Apertura, Inicio Show, Hora Término y Duración Total.
   - Barra visual de tiempo (*Timeline*) proporcional con tooltips de inicio/fin para cada bloque.

4. **Impresión A4 Multipágina Especializada**:
   - **Página 1**: Estructura de producción, parámetros y configuración de bloques.
   - **Página 2**: Escaleta oficial definitiva con formato de lectura rápida de alta visibilidad para cabina de control y escenario.

5. **Persistencia Híbrida & Exportación**:
   - Sincronización automática con la API REST del backend.
   - Modo Offline con `LocalStorage` si se ejecuta directamente desde el navegador.
   - Exportación de copias de seguridad en formato `.json`.

---

## 🛠️ Cómo Ejecutar

### Opción 1: Con Node.js (Servidor Completo)
1. Abre una terminal en la carpeta del proyecto.
2. Instala dependencias e inicia el servidor:
   ```bash
   cd backend
   npm install
   npm start
   ```
3. Accede a tu navegador en: [http://localhost:3000](http://localhost:3000)

### Opción 2: Ejecución Rápida en Windows
- Haz doble clic en `start.bat` o ejecuta `./start.ps1` en PowerShell.

### Opción 3: Navegador Directo (Modo Offline)
- Abre `frontend/index.html` para la presentación pública o `frontend/app.html` para el planificador.

---

## 📡 Endpoints de la API REST

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/health` | Estado del servidor y hora |
| `GET` | `/api/projects` | Listar todos los proyectos guardados |
| `GET` | `/api/projects/:name` | Obtener un proyecto específico |
| `POST` | `/api/projects` | Crear o actualizar un proyecto |
| `DELETE` | `/api/projects/:name` | Eliminar un proyecto |
| `GET` | `/api/projects/export` | Descargar todos los proyectos en JSON |
