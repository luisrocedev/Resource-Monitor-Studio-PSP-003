# Sistema de Monitorización de Recursos del Sistema - Resource Monitor Studio

**DNI:** 53945291X  
**Curso:** DAM2 — Programación de servicios y procesos  
**Actividad:** 003-Monitorización de recursos  
**Tecnologías:** Python 3.13 · psutil · Flask · SQLite · Chart.js  
**Fecha:** 17 de febrero de 2026

---

## 1. Introducción breve y contextualización (25%)

### Concepto general

La monitorización de recursos del sistema es una técnica fundamental en la administración de servidores y aplicaciones que consiste en **recolectar, almacenar y analizar métricas** sobre el uso de CPU, memoria RAM, disco, red y procesos en ejecución. Este proyecto implementa un sistema completo de monitorización que:

- **Recolecta métricas** cada N segundos usando la librería `psutil`
- **Almacena historial** en base de datos SQLite para análisis temporal
- **Genera alertas** automáticas cuando se superan umbrales configurados
- **Visualiza datos** en dashboard web con gráficas en tiempo real
- **Expone API REST** para integración con otros sistemas

### Arquitectura del sistema

```
┌─────────────────────────────────────────┐
│  Resource Monitor Studio                │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │  MetricsCollector (Thread)        │  │
│  │  - Recolección cada N segundos    │  │
│  │  - psutil: CPU, RAM, Disk, Net    │  │
│  │  - Detección de top processes     │  │
│  └──────────────┬────────────────────┘  │
│                 │                        │
│                 ▼                        │
│  ┌───────────────────────────────────┐  │
│  │  AlertEngine                      │  │
│  │  - Evaluación de umbrales         │  │
│  │  - Generación de alertas          │  │
│  └──────────────┬────────────────────┘  │
│                 │                        │
│                 ▼                        │
│  ┌───────────────────────────────────┐  │
│  │  Database (SQLite)                │  │
│  │  - metrics (serie temporal)       │  │
│  │  - alerts (histórico alertas)     │  │
│  └──────────────┬────────────────────┘  │
│                 │                        │
│                 ▼                        │
│  ┌───────────────────────────────────┐  │
│  │  Flask API REST                   │  │
│  │  - /api/current (última métrica)  │  │
│  │  - /api/series (histórico)        │  │
│  │  - /api/alerts (alertas)          │  │
│  │  - /api/control (pausa/resume)    │  │
│  └──────────────┬────────────────────┘  │
└─────────────────┼────────────────────────┘
                  │
                  ▼
        ┌─────────────────┐
        │  Dashboard Web  │
        │  (HTML + JS)    │
        └─────────────────┘
```

### Métricas monitorizadas

| Métrica      | Descripción                     | Fuente psutil              |
| ------------ | ------------------------------- | -------------------------- |
| **CPU %**    | Porcentaje de uso de CPU        | `psutil.cpu_percent()`     |
| **RAM %**    | Porcentaje de memoria utilizada | `psutil.virtual_memory()`  |
| **Disco %**  | Porcentaje de espacio usado     | `psutil.disk_usage('/')`   |
| **Red TX**   | Bytes enviados por red          | `psutil.net_io_counters()` |
| **Red RX**   | Bytes recibidos por red         | `psutil.net_io_counters()` |
| **Procesos** | Número de procesos activos      | `len(psutil.pids())`       |

### Contexto y utilidad

Los sistemas de monitorización son fundamentales porque:

- **Detección temprana:** Identificar problemas antes de que afecten a usuarios
- **Planificación de capacidad:** Analizar tendencias para escalar recursos
- **Optimización:** Identificar procesos que consumen recursos excesivos
- **SLA monitoring:** Verificar cumplimiento de acuerdos de nivel de servicio
- **Auditoría:** Mantener histórico para análisis post-mortem

Este proyecto demuestra cómo implementar un sistema de monitorización usando **threading** para recolección en segundo plano, **persistencia** para análisis histórico y **visualización web** para operadores humanos.

---

## 2. Desarrollo detallado y preciso (25%)

### Recolector de métricas del sistema

```python
# metrics_collector.py - Recolección de métricas con psutil

import psutil
import threading
import time
import logging
from datetime import datetime
from typing import Dict, List, Callable

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class MetricsCollector:
    """
    Recolector de métricas del sistema que ejecuta en segundo plano
    """

    def __init__(self, interval: int = 5, on_metric: Callable = None):
        """
        Args:
            interval: Segundos entre cada recolección
            on_metric: Callback a ejecutar con cada métrica recolectada
        """
        self.interval = interval
        self.on_metric = on_metric
        self.running = False
        self.paused = False
        self.thread = None

        # Almacenar lecturas anteriores para calcular deltas
        self.prev_net_io = None

    def start(self):
        """Inicia la recolección en thread separado"""
        if self.running:
            logger.warning("Collector ya está corriendo")
            return

        self.running = True
        self.paused = False

        self.thread = threading.Thread(target=self._collect_loop, daemon=True)
        self.thread.start()

        logger.info(f"✓ MetricsCollector iniciado (intervalo: {self.interval}s)")

    def stop(self):
        """Detiene la recolección"""
        self.running = False

        if self.thread:
            self.thread.join(timeout=5)

        logger.info("🛑 MetricsCollector detenido")

    def pause(self):
        """Pausa la recolección temporalmente"""
        self.paused = True
        logger.info("⏸️  MetricsCollector pausado")

    def resume(self):
        """Reanuda la recolección"""
        self.paused = False
        logger.info("▶️  MetricsCollector reanudado")

    def _collect_loop(self):
        """Loop principal de recolección"""
        while self.running:
            if not self.paused:
                try:
                    metric = self.collect_metric()

                    if self.on_metric:
                        self.on_metric(metric)

                except Exception as e:
                    logger.error(f"❌ Error recolectando métrica: {e}")

            # Esperar intervalo
            time.sleep(self.interval)

    def collect_metric(self) -> Dict:
        """
        Recolecta todas las métricas del sistema

        Returns:
            Diccionario con todas las métricas
        """
        timestamp = datetime.now()

        # CPU
        cpu_percent = psutil.cpu_percent(interval=0.1)
        cpu_count = psutil.cpu_count()

        # RAM
        memory = psutil.virtual_memory()

        # Disco
        disk = psutil.disk_usage('/')

        # Red (deltas desde última lectura)
        net_io = psutil.net_io_counters()

        if self.prev_net_io:
            net_tx_rate = net_io.bytes_sent - self.prev_net_io.bytes_sent
            net_rx_rate = net_io.bytes_recv - self.prev_net_io.bytes_recv
        else:
            net_tx_rate = 0
            net_rx_rate = 0

        self.prev_net_io = net_io

        # Procesos
        process_count = len(psutil.pids())

        # Top 5 procesos por CPU
        top_processes = self._get_top_processes(5)

        metric = {
            'timestamp': timestamp.isoformat(),

            # CPU
            'cpu_percent': round(cpu_percent, 2),
            'cpu_count': cpu_count,

            # RAM
            'ram_total_gb': round(memory.total / (1024**3), 2),
            'ram_used_gb': round(memory.used / (1024**3), 2),
            'ram_percent': round(memory.percent, 2),

            # Disco
            'disk_total_gb': round(disk.total / (1024**3), 2),
            'disk_used_gb': round(disk.used / (1024**3), 2),
            'disk_percent': round(disk.percent, 2),

            # Red (bytes/segundo)
            'net_tx_rate': net_tx_rate,
            'net_rx_rate': net_rx_rate,
            'net_tx_total': net_io.bytes_sent,
            'net_rx_total': net_io.bytes_recv,

            # Procesos
            'process_count': process_count,
            'top_processes': top_processes
        }

        logger.info(f"📊 CPU: {cpu_percent}% | RAM: {memory.percent}% | Disk: {disk.percent}%")

        return metric

    def _get_top_processes(self, limit: int = 5) -> List[Dict]:
        """
        Obtiene los procesos que más CPU consumen

        Args:
            limit: Número máximo de procesos a retornar

        Returns:
            Lista de diccionarios con info de procesos
        """
        processes = []

        for proc in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_percent']):
            try:
                info = proc.info
                processes.append({
                    'pid': info['pid'],
                    'name': info['name'],
                    'cpu_percent': round(info['cpu_percent'] or 0, 2),
                    'memory_percent': round(info['memory_percent'] or 0, 2)
                })
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

        # Ordenar por CPU descendente
        processes.sort(key=lambda p: p['cpu_percent'], reverse=True)

        return processes[:limit]
```

### Motor de alertas con umbrales

```python
# alert_engine.py - Sistema de alertas por umbrales

import logging
from typing import Dict, List
from datetime import datetime

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class AlertRule:
    """Regla de alerta con umbral"""

    def __init__(self, metric_name: str, warning_threshold: float,
                 critical_threshold: float, metric_key: str):
        self.metric_name = metric_name
        self.warning_threshold = warning_threshold
        self.critical_threshold = critical_threshold
        self.metric_key = metric_key

    def evaluate(self, metric: Dict) -> Dict:
        """
        Evalúa métrica contra umbrales

        Args:
            metric: Diccionario con métricas

        Returns:
            Diccionario con alerta (o None si todo OK)
        """
        value = metric.get(self.metric_key)

        if value is None:
            return None

        severity = None

        if value >= self.critical_threshold:
            severity = 'critical'
        elif value >= self.warning_threshold:
            severity = 'warning'

        if severity:
            return {
                'metric_name': self.metric_name,
                'metric_key': self.metric_key,
                'value': value,
                'severity': severity,
                'threshold': self.critical_threshold if severity == 'critical' else self.warning_threshold,
                'timestamp': metric['timestamp'],
                'message': f"{self.metric_name} en {severity.upper()}: {value}%"
            }

        return None


class AlertEngine:
    """
    Motor de evaluación de alertas
    """

    def __init__(self, on_alert: callable = None):
        """
        Args:
            on_alert: Callback a ejecutar cuando se genera una alerta
        """
        self.on_alert = on_alert
        self.rules: List[AlertRule] = []

        # Reglas por defecto
        self._init_default_rules()

    def _init_default_rules(self):
        """Inicializa reglas de alerta por defecto"""
        self.rules = [
            AlertRule('CPU Usage', warning_threshold=70, critical_threshold=90, metric_key='cpu_percent'),
            AlertRule('RAM Usage', warning_threshold=75, critical_threshold=90, metric_key='ram_percent'),
            AlertRule('Disk Usage', warning_threshold=80, critical_threshold=95, metric_key='disk_percent'),
        ]

        logger.info(f"✓ {len(self.rules)} reglas de alerta configuradas")

    def add_rule(self, rule: AlertRule):
        """Añade una nueva regla de alerta"""
        self.rules.append(rule)
        logger.info(f"✓ Regla añadida: {rule.metric_name}")

    def evaluate_metric(self, metric: Dict) -> List[Dict]:
        """
        Evalúa una métrica contra todas las reglas

        Args:
            metric: Diccionario con métricas del sistema

        Returns:
            Lista de alertas generadas
        """
        alerts = []

        for rule in self.rules:
            alert = rule.evaluate(metric)

            if alert:
                alerts.append(alert)

                logger.warning(f"⚠️  ALERTA: {alert['message']}")

                if self.on_alert:
                    self.on_alert(alert)

        return alerts
```

### Persistencia en SQLite

```python
# database.py - Gestión de base de datos

import sqlite3
from datetime import datetime, timedelta
from typing import List, Dict
import json
import logging
import threading

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class MonitorDatabase:
    """
    Gestor de base de datos para métricas y alertas
    """

    def __init__(self, db_path: str = 'monitor.db'):
        self.db_path = db_path
        self.local = threading.local()
        self.init_database()

    def get_connection(self):
        """Obtiene conexión thread-safe"""
        if not hasattr(self.local, 'conn'):
            self.local.conn = sqlite3.connect(self.db_path)
            self.local.conn.row_factory = sqlite3.Row
        return self.local.conn

    def init_database(self):
        """Inicializa esquema de la base de datos"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        # Tabla de métricas
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                cpu_percent REAL,
                cpu_count INTEGER,
                ram_total_gb REAL,
                ram_used_gb REAL,
                ram_percent REAL,
                disk_total_gb REAL,
                disk_used_gb REAL,
                disk_percent REAL,
                net_tx_rate INTEGER,
                net_rx_rate INTEGER,
                process_count INTEGER,
                top_processes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # Tabla de alertas
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                metric_id INTEGER,
                metric_name TEXT NOT NULL,
                metric_key TEXT NOT NULL,
                value REAL NOT NULL,
                severity TEXT NOT NULL,
                threshold REAL NOT NULL,
                message TEXT,
                timestamp TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (metric_id) REFERENCES metrics(id)
            )
        ''')

        # Índices
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts(timestamp)')

        conn.commit()
        conn.close()

        logger.info("✓ Base de datos inicializada")

    def insert_metric(self, metric: Dict) -> int:
        """
        Inserta métrica en la base de datos

        Args:
            metric: Diccionario con métricas

        Returns:
            ID de la métrica insertada
        """
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('''
            INSERT INTO metrics
            (timestamp, cpu_percent, cpu_count, ram_total_gb, ram_used_gb, ram_percent,
             disk_total_gb, disk_used_gb, disk_percent, net_tx_rate, net_rx_rate,
             process_count, top_processes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            metric['timestamp'],
            metric['cpu_percent'],
            metric['cpu_count'],
            metric['ram_total_gb'],
            metric['ram_used_gb'],
            metric['ram_percent'],
            metric['disk_total_gb'],
            metric['disk_used_gb'],
            metric['disk_percent'],
            metric['net_tx_rate'],
            metric['net_rx_rate'],
            metric['process_count'],
            json.dumps(metric['top_processes'])
        ))

        metric_id = cursor.lastrowid
        conn.commit()

        return metric_id

    def insert_alert(self, alert: Dict, metric_id: int = None):
        """Inserta alerta en la base de datos"""
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('''
            INSERT INTO alerts
            (metric_id, metric_name, metric_key, value, severity, threshold, message, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            metric_id,
            alert['metric_name'],
            alert['metric_key'],
            alert['value'],
            alert['severity'],
            alert['threshold'],
            alert['message'],
            alert['timestamp']
        ))

        conn.commit()

        logger.info(f"✓ Alerta guardada: {alert['severity']} - {alert['metric_name']}")

    def get_recent_metrics(self, limit: int = 50) -> List[Dict]:
        """Obtiene métricas recientes"""
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('''
            SELECT * FROM metrics
            ORDER BY created_at DESC
            LIMIT ?
        ''', (limit,))

        rows = cursor.fetchall()

        metrics = []
        for row in rows:
            metric = dict(row)
            # Parsear JSON de top_processes
            if metric['top_processes']:
                metric['top_processes'] = json.loads(metric['top_processes'])
            metrics.append(metric)

        return metrics

    def get_metrics_range(self, hours: int = 24) -> List[Dict]:
        """Obtiene métricas de las últimas N horas"""
        conn = self.get_connection()
        cursor = conn.cursor()

        since = (datetime.now() - timedelta(hours=hours)).isoformat()

        cursor.execute('''
            SELECT * FROM metrics
            WHERE timestamp >= ?
            ORDER BY timestamp ASC
        ''', (since,))

        rows = cursor.fetchall()

        return [dict(row) for row in rows]

    def get_recent_alerts(self, limit: int = 50) -> List[Dict]:
        """Obtiene alertas recientes"""
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('''
            SELECT * FROM alerts
            ORDER BY created_at DESC
            LIMIT ?
        ''', (limit,))

        rows = cursor.fetchall()

        return [dict(row) for row in rows]

    def get_stats(self) -> Dict:
        """Obtiene estadísticas agregadas"""
        conn = self.get_connection()
        cursor = conn.cursor()

        # Total métricas
        cursor.execute('SELECT COUNT(*) FROM metrics')
        total_metrics = cursor.fetchone()[0]

        # Total alertas
        cursor.execute('SELECT COUNT(*) FROM alerts')
        total_alerts = cursor.fetchone()[0]

        # Alertas por severidad
        cursor.execute('''
            SELECT severity, COUNT(*) as count
            FROM alerts
            GROUP BY severity
        ''')

        severity_counts = {row[0]: row[1] for row in cursor.fetchall()}

        # Última métrica
        cursor.execute('SELECT * FROM metrics ORDER BY created_at DESC LIMIT 1')
        row = cursor.fetchone()
        last_metric = dict(row) if row else None

        if last_metric and last_metric['top_processes']:
            last_metric['top_processes'] = json.loads(last_metric['top_processes'])

        return {
            'total_metrics': total_metrics,
            'total_alerts': total_alerts,
            'severity_counts': severity_counts,
            'last_metric': last_metric
        }

    def cleanup_old_data(self, days: int = 30):
        """Limpia datos antiguos para evitar crecimiento infinito"""
        conn = self.get_connection()
        cursor = conn.cursor()

        cutoff = (datetime.now() - timedelta(days=days)).isoformat()

        cursor.execute('DELETE FROM metrics WHERE timestamp < ?', (cutoff,))
        deleted_metrics = cursor.rowcount

        cursor.execute('DELETE FROM alerts WHERE timestamp < ?', (cutoff,))
        deleted_alerts = cursor.rowcount

        conn.commit()

        logger.info(f"🗑️  Limpieza: {deleted_metrics} métricas, {deleted_alerts} alertas eliminadas")
```

### Aplicación Flask con API REST

```python
# app.py - Servidor principal con API REST

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from metrics_collector import MetricsCollector
from alert_engine import AlertEngine
from database import MonitorDatabase

app = Flask(__name__)
CORS(app)

# Componentes del sistema
db = MonitorDatabase('monitor.db')
alert_engine = AlertEngine()
collector = None

# Estado del sistema
last_metric = None

def on_metric_collected(metric):
    """Callback ejecutado cuando se recolecta métrica"""
    global last_metric

    # Guardar en DB
    metric_id = db.insert_metric(metric)

    # Evaluar alertas
    alerts = alert_engine.evaluate_metric(metric)

    # Guardar alertas en DB
    for alert in alerts:
        db.insert_alert(alert, metric_id)

    # Actualizar última métrica
    last_metric = metric

# Rutas de la API

@app.route('/')
def index():
    """Sirve el dashboard HTML"""
    return send_from_directory('.', 'dashboard.html')

@app.route('/api/current', methods=['GET'])
def get_current():
    """
    Obtiene la métrica más reciente

    Returns:
        JSON con última métrica recolectada
    """
    if last_metric:
        return jsonify(last_metric)

    # Si no hay en memoria, buscar en DB
    stats = db.get_stats()

    if stats['last_metric']:
        return jsonify(stats['last_metric'])

    return jsonify({'error': 'No hay métricas disponibles'}), 404

@app.route('/api/series', methods=['GET'])
def get_series():
    """
    Obtiene serie temporal de métricas

    Query params:
        hours: Horas hacia atrás (default: 24)

    Returns:
        JSON con array de métricas
    """
    hours = request.args.get('hours', 24, type=int)

    metrics = db.get_metrics_range(hours)

    return jsonify(metrics)

@app.route('/api/alerts', methods=['GET'])
def get_alerts():
    """
    Obtiene historial de alertas

    Query params:
        limit: Número máximo de alertas (default: 50)

    Returns:
        JSON con array de alertas
    """
    limit = request.args.get('limit', 50, type=int)

    alerts = db.get_recent_alerts(limit)

    return jsonify(alerts)

@app.route('/api/stats', methods=['GET'])
def get_stats():
    """
    Obtiene estadísticas generales

    Returns:
        JSON con métricas agregadas
    """
    stats = db.get_stats()

    # Añadir estado del collector
    stats['collector_running'] = collector.running if collector else False
    stats['collector_paused'] = collector.paused if collector else False

    return jsonify(stats)

@app.route('/api/control', methods=['POST'])
def control():
    """
    Controla el collector

    Body JSON:
        {
            "action": "start" | "stop" | "pause" | "resume",
            "interval": 5  (opcional, solo para start)
        }
    """
    global collector

    data = request.json
    action = data.get('action')

    if action == 'start':
        if collector and collector.running:
            return jsonify({'error': 'Collector ya está corriendo'}), 400

        interval = data.get('interval', 5)

        collector = MetricsCollector(interval=interval, on_metric=on_metric_collected)
        collector.start()

        return jsonify({'status': 'started', 'interval': interval})

    elif action == 'stop':
        if collector:
            collector.stop()
            collector = None

        return jsonify({'status': 'stopped'})

    elif action == 'pause':
        if collector:
            collector.pause()
            return jsonify({'status': 'paused'})

        return jsonify({'error': 'No hay collector activo'}), 400

    elif action == 'resume':
        if collector:
            collector.resume()
            return jsonify({'status': 'resumed'})

        return jsonify({'error': 'No hay collector activo'}), 400

    return jsonify({'error': 'Acción no válida'}), 400

if __name__ == '__main__':
    # Iniciar collector automáticamente
    collector = MetricsCollector(interval=5, on_metric=on_metric_collected)
    collector.start()

    # Iniciar Flask
    app.run(host='0.0.0.0', port=5000, debug=False)
```

---

## 3. Aplicación práctica (25%)

### Dashboard web con visualización en tiempo real

```html
<!-- dashboard.html - Panel de control del sistema -->
<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Resource Monitor Studio</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      body {
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: #2d3748;
        padding: 20px;
      }

      .container {
        max-width: 1600px;
        margin: 0 auto;
      }

      header {
        background: white;
        padding: 20px 30px;
        border-radius: 12px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        margin-bottom: 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      h1 {
        font-size: 1.8rem;
        color: #667eea;
      }

      .controls {
        display: flex;
        gap: 10px;
      }

      button {
        padding: 10px 20px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.9rem;
        font-weight: 600;
        transition: all 0.3s;
      }

      .btn-primary {
        background: #667eea;
        color: white;
      }

      .btn-primary:hover {
        background: #5a67d8;
        transform: translateY(-2px);
      }

      .btn-warning {
        background: #ed8936;
        color: white;
      }

      .btn-danger {
        background: #f56565;
        color: white;
      }

      .kpi-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 20px;
        margin-bottom: 20px;
      }

      .kpi-card {
        background: white;
        padding: 25px;
        border-radius: 12px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        position: relative;
        overflow: hidden;
      }

      .kpi-card::before {
        content: "";
        position: absolute;
        top: 0;
        left: 0;
        width: 4px;
        height: 100%;
        background: linear-gradient(180deg, #667eea, #764ba2);
      }

      .kpi-value {
        font-size: 2.5rem;
        font-weight: 700;
        color: #667eea;
        margin-bottom: 5px;
      }

      .kpi-label {
        font-size: 0.9rem;
        color: #718096;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .kpi-sublabel {
        font-size: 0.8rem;
        color: #a0aec0;
        margin-top: 5px;
      }

      .charts-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
        gap: 20px;
        margin-bottom: 20px;
      }

      .chart-card {
        background: white;
        padding: 20px;
        border-radius: 12px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      }

      .chart-card h3 {
        color: #2d3748;
        margin-bottom: 15px;
        font-size: 1.1rem;
      }

      .table-card {
        background: white;
        padding: 20px;
        border-radius: 12px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        margin-bottom: 20px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th {
        text-align: left;
        padding: 12px;
        background: #f7fafc;
        color: #4a5568;
        font-weight: 600;
        font-size: 0.85rem;
        text-transform: uppercase;
        border-bottom: 2px solid #e2e8f0;
      }

      td {
        padding: 12px;
        border-bottom: 1px solid #e2e8f0;
      }

      tr:hover {
        background: #f7fafc;
      }

      .badge {
        display: inline-block;
        padding: 4px 12px;
        border-radius: 12px;
        font-size: 0.75rem;
        font-weight: 600;
      }

      .badge-warning {
        background: #fbd38d;
        color: #7c2d12;
      }

      .badge-critical {
        background: #fc8181;
        color: #742a2a;
      }

      .progress-bar {
        width: 100%;
        height: 8px;
        background: #e2e8f0;
        border-radius: 4px;
        overflow: hidden;
        margin-top: 10px;
      }

      .progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #667eea, #764ba2);
        transition: width 0.3s;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <header>
        <div>
          <h1>📊 Resource Monitor Studio</h1>
          <p style="color: #718096; margin-top: 5px;">
            Monitorización en tiempo real de recursos del sistema
          </p>
        </div>
        <div class="controls">
          <button class="btn-primary" onclick="refreshData()">
            🔄 Actualizar
          </button>
          <button class="btn-warning" onclick="pauseCollector()">
            ⏸️ Pausar
          </button>
          <button class="btn-primary" onclick="resumeCollector()">
            ▶️ Reanudar
          </button>
        </div>
      </header>

      <!-- KPIs -->
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-value" id="kpiCpu">0%</div>
          <div class="kpi-label">CPU Usage</div>
          <div class="kpi-sublabel" id="kpiCpuCores">0 cores</div>
          <div class="progress-bar">
            <div class="progress-fill" id="progressCpu" style="width: 0%"></div>
          </div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value" id="kpiRam">0%</div>
          <div class="kpi-label">RAM Usage</div>
          <div class="kpi-sublabel" id="kpiRamUsed">0 / 0 GB</div>
          <div class="progress-bar">
            <div class="progress-fill" id="progressRam" style="width: 0%"></div>
          </div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value" id="kpiDisk">0%</div>
          <div class="kpi-label">Disk Usage</div>
          <div class="kpi-sublabel" id="kpiDiskUsed">0 / 0 GB</div>
          <div class="progress-bar">
            <div
              class="progress-fill"
              id="progressDisk"
              style="width: 0%"
            ></div>
          </div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value" id="kpiProcesses">0</div>
          <div class="kpi-label">Procesos Activos</div>
          <div class="kpi-sublabel">Total en el sistema</div>
        </div>
      </div>

      <!-- Gráficas -->
      <div class="charts-grid">
        <div class="chart-card">
          <h3>CPU & RAM (últimas 24h)</h3>
          <canvas id="cpuRamChart"></canvas>
        </div>
        <div class="chart-card">
          <h3>Red (TX/RX últimas 24h)</h3>
          <canvas id="networkChart"></canvas>
        </div>
      </div>

      <!-- Top Procesos -->
      <div class="table-card">
        <h3>🔥 Top Procesos por CPU</h3>
        <table>
          <thead>
            <tr>
              <th>PID</th>
              <th>Nombre</th>
              <th>CPU %</th>
              <th>RAM %</th>
            </tr>
          </thead>
          <tbody id="topProcessesTable">
            <tr>
              <td colspan="4" style="text-align: center; color: #a0aec0;">
                Cargando...
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Alertas -->
      <div class="table-card">
        <h3>⚠️ Alertas Recientes</h3>
        <table>
          <thead>
            <tr>
              <th>Métrica</th>
              <th>Valor</th>
              <th>Umbral</th>
              <th>Severidad</th>
              <th>Mensaje</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody id="alertsTable">
            <tr>
              <td colspan="6" style="text-align: center; color: #a0aec0;">
                Cargando...
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <script>
      const API_URL = "http://localhost:5000";

      let cpuRamChart = null;
      let networkChart = null;

      // Inicializar gráficas
      function initCharts() {
        const cpuRamCtx = document
          .getElementById("cpuRamChart")
          .getContext("2d");
        cpuRamChart = new Chart(cpuRamCtx, {
          type: "line",
          data: {
            labels: [],
            datasets: [
              {
                label: "CPU %",
                data: [],
                borderColor: "#667eea",
                backgroundColor: "rgba(102, 126, 234, 0.1)",
                tension: 0.4,
                fill: true,
              },
              {
                label: "RAM %",
                data: [],
                borderColor: "#f56565",
                backgroundColor: "rgba(245, 101, 101, 0.1)",
                tension: 0.4,
                fill: true,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
              legend: {
                position: "top",
              },
            },
            scales: {
              y: {
                beginAtZero: true,
                max: 100,
              },
            },
          },
        });

        const networkCtx = document
          .getElementById("networkChart")
          .getContext("2d");
        networkChart = new Chart(networkCtx, {
          type: "line",
          data: {
            labels: [],
            datasets: [
              {
                label: "TX (KB/s)",
                data: [],
                borderColor: "#48bb78",
                backgroundColor: "rgba(72, 187, 120, 0.1)",
                tension: 0.4,
                fill: true,
              },
              {
                label: "RX (KB/s)",
                data: [],
                borderColor: "#ed8936",
                backgroundColor: "rgba(237, 137, 54, 0.1)",
                tension: 0.4,
                fill: true,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
              legend: {
                position: "top",
              },
            },
            scales: {
              y: {
                beginAtZero: true,
              },
            },
          },
        });
      }

      // Actualizar KPIs
      async function updateKPIs() {
        try {
          const response = await fetch(`${API_URL}/api/current`);
          const metric = await response.json();

          // CPU
          document.getElementById("kpiCpu").textContent =
            `${metric.cpu_percent}%`;
          document.getElementById("kpiCpuCores").textContent =
            `${metric.cpu_count} cores`;
          document.getElementById("progressCpu").style.width =
            `${metric.cpu_percent}%`;

          // RAM
          document.getElementById("kpiRam").textContent =
            `${metric.ram_percent}%`;
          document.getElementById("kpiRamUsed").textContent =
            `${metric.ram_used_gb} / ${metric.ram_total_gb} GB`;
          document.getElementById("progressRam").style.width =
            `${metric.ram_percent}%`;

          // Disco
          document.getElementById("kpiDisk").textContent =
            `${metric.disk_percent}%`;
          document.getElementById("kpiDiskUsed").textContent =
            `${metric.disk_used_gb} / ${metric.disk_total_gb} GB`;
          document.getElementById("progressDisk").style.width =
            `${metric.disk_percent}%`;

          // Procesos
          document.getElementById("kpiProcesses").textContent =
            metric.process_count;

          // Top procesos
          updateTopProcesses(metric.top_processes);
        } catch (error) {
          console.error("Error actualizando KPIs:", error);
        }
      }

      // Actualizar top procesos
      function updateTopProcesses(processes) {
        const tbody = document.getElementById("topProcessesTable");

        if (!processes || processes.length === 0) {
          tbody.innerHTML =
            '<tr><td colspan="4" style="text-align: center; color: #a0aec0;">Sin datos</td></tr>';
          return;
        }

        tbody.innerHTML = processes
          .map(
            (proc) => `
                <tr>
                    <td>${proc.pid}</td>
                    <td>${proc.name}</td>
                    <td>${proc.cpu_percent}%</td>
                    <td>${proc.memory_percent.toFixed(2)}%</td>
                </tr>
            `,
          )
          .join("");
      }

      // Actualizar gráficas
      async function updateCharts() {
        try {
          const response = await fetch(`${API_URL}/api/series?hours=24`);
          const metrics = await response.json();

          if (metrics.length === 0) return;

          // Limitar a últimos 50 puntos para no saturar
          const recentMetrics = metrics.slice(-50);

          const labels = recentMetrics.map((m) => {
            const date = new Date(m.timestamp);
            return date.toLocaleTimeString();
          });

          // CPU y RAM
          cpuRamChart.data.labels = labels;
          cpuRamChart.data.datasets[0].data = recentMetrics.map(
            (m) => m.cpu_percent,
          );
          cpuRamChart.data.datasets[1].data = recentMetrics.map(
            (m) => m.ram_percent,
          );
          cpuRamChart.update();

          // Red (convertir a KB/s)
          networkChart.data.labels = labels;
          networkChart.data.datasets[0].data = recentMetrics.map(
            (m) => m.net_tx_rate / 1024,
          );
          networkChart.data.datasets[1].data = recentMetrics.map(
            (m) => m.net_rx_rate / 1024,
          );
          networkChart.update();
        } catch (error) {
          console.error("Error actualizando gráficas:", error);
        }
      }

      // Actualizar alertas
      async function updateAlerts() {
        try {
          const response = await fetch(`${API_URL}/api/alerts?limit=20`);
          const alerts = await response.json();

          const tbody = document.getElementById("alertsTable");

          if (alerts.length === 0) {
            tbody.innerHTML =
              '<tr><td colspan="6" style="text-align: center; color: #a0aec0;">No hay alertas</td></tr>';
            return;
          }

          tbody.innerHTML = alerts
            .map(
              (alert) => `
                    <tr>
                        <td>${alert.metric_name}</td>
                        <td>${alert.value}%</td>
                        <td>${alert.threshold}%</td>
                        <td>
                            <span class="badge badge-${alert.severity}">
                                ${alert.severity.toUpperCase()}
                            </span>
                        </td>
                        <td>${alert.message}</td>
                        <td>${new Date(alert.created_at).toLocaleString()}</td>
                    </tr>
                `,
            )
            .join("");
        } catch (error) {
          console.error("Error actualizando alertas:", error);
        }
      }

      // Refrescar todos los datos
      async function refreshData() {
        await updateKPIs();
        await updateCharts();
        await updateAlerts();
      }

      // Control del collector
      async function pauseCollector() {
        try {
          await fetch(`${API_URL}/api/control`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "pause" }),
          });
          alert("Collector pausado");
        } catch (error) {
          console.error("Error:", error);
        }
      }

      async function resumeCollector() {
        try {
          await fetch(`${API_URL}/api/control`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "resume" }),
          });
          alert("Collector reanudado");
        } catch (error) {
          console.error("Error:", error);
        }
      }

      // Inicialización
      initCharts();
      refreshData();

      // Auto-actualización cada 5 segundos
      setInterval(refreshData, 5000);
    </script>
  </body>
</html>
```

---

## 4. Conclusión breve (25%)

### Resumen de puntos clave

Este sistema de monitorización de recursos demuestra:

1. **Recolección periódica:** Thread en segundo plano con psutil
2. **Múltiples métricas:** CPU, RAM, disco, red y procesos
3. **Sistema de alertas:** Evaluación automática de umbrales
4. **Persistencia temporal:** SQLite con series temporales
5. **Visualización avanzada:** Gráficas con Chart.js
6. **Control runtime:** API para pausar/reanudar recolección

### Métricas recolectadas vs RAM utilizada

| MB en RAM | Métricas guardadas | Días de retención        |
| --------- | ------------------ | ------------------------ |
| ~0.5 MB   | 1.000 métricas     | ~14 horas (5s intervalo) |
| ~5 MB     | 10.000 métricas    | ~5.8 días                |
| ~50 MB    | 100.000 métricas   | ~58 días                 |

Con limpieza automática cada 30 días, el sistema es sostenible.

### Enlace con contenidos de la unidad

Este proyecto integra conceptos del módulo:

- **Threading (Unidad 1):** Recolección en segundo plano sin bloquear API
- **Sincronización (Unidad 1):** Thread-safe database con threadlocal
- **Monitorización (Unidad 5):** Uso de psutil para métricas del sistema
- **Servicios (Unidad 4):** API REST para consultas externas
- **Persistencia (Unidad 6):** SQLite con series temporales

### Aplicaciones en el mundo real

Los sistemas de monitorización son críticos en:

- **DevOps:** Prometheus + Grafana para infraestructura cloud
- **APM:** New Relic, Datadog para rendimiento de aplicaciones
- **Servidores:** Nagios, Zabbix para alertas operativas
- **Contenedores:** cAdvisor para Docker/Kubernetes
- **IoT:** Monitorización de dispositivos embebidos
- **Gaming:** Telemetría de rendimiento en clientes

### Patrones de diseño

El sistema implementa:

**Observer Pattern:** Collector notifica cuando hay métricas (`on_metric` callback)  
**Strategy Pattern:** AlertEngine con reglas intercambiables  
**Repository Pattern:** MonitorDatabase abstrae acceso a datos  
**Singleton Pattern:** Una sola instancia del collector en app.py

### Futuras mejoras

Posibles extensiones:

- **Predicción:** Machine learning para detectar anomalías
- **Distributed tracing:** Correlación de métricas entre servidores
- **Custom metrics:** API para que apps envíen métricas propias
- **Dashboards múltiples:** Diferentes vistas por rol (admin, dev, ops)
- **Exportación:** Prometheus exporter para integrar con ecosistema existente
- **Notificaciones:** Email, Slack, PagerDuty para alertas críticas
- **Agregación inteligente:** Downsampling para reducir almacenamiento
- **Comparación histórica:** "Hoy vs hace 1 semana" para detectar regresiones

---

## Anexo — Mejoras aplicadas a la interfaz (v 2.0)

Se han rediseñado por completo los tres ficheros del front-end (`styles.css`, `index.html` y `app.js`) manteniendo intacto el back-end (`app.py`, `simulate_spike.py`, `requirements.txt`). A continuación se detallan las **14 mejoras** implementadas:

### 1. Sistema de diseño con variables CSS

Todo el aspecto visual se gobierna desde `:root` con variables semánticas (`--bg`, `--panel`, `--border`, `--text`, `--blue`, `--cyan`, `--green`, `--amber`, `--red`, `--violet`). Cambiar un color o un radio de borde se propaga automáticamente a toda la aplicación.

### 2. Modo oscuro con persistencia

Botón 🌙 / ☀️ que conmuta la clase `body.dark`. La preferencia se guarda en `localStorage` y se recupera en cada visita. Al cambiar de tema las gráficas Chart.js se reconstruyen con colores de ejes y rejilla adaptados.

### 3. Navegación por pestañas

Se ha sustituido el diseño monolítico por tres pestañas: **Dashboard** (gráficas en tiempo real), **Alertas** (tabla de alertas con filtros) y **Control** (pausa/reanudación, intervalo, simulación de pico). La pestaña activa se resalta con un borde inferior azul.

### 4. KPI strip con 6 indicadores

Banda de tarjetas con borde lateral de color: Muestras (azul), CPU (cian), RAM (verde), Disco (ámbar), Procesos (violeta) y Alertas críticas (rojo). Se actualizan automáticamente cada 4 segundos.

### 5. Indicador de estado del muestreo

Punto animado (🟢 activo con `pulse` / 🟡 pausado estático) junto a texto descriptivo en la cabecera, proporcionando feedback inmediato del estado del sampler.

### 6. Notificaciones toast

Mensajes no intrusivos que aparecen en la esquina inferior derecha y desaparecen tras 3.2 s. Cuatro variantes: `success` (verde), `error` (rojo), `info` (azul) y `warning` (ámbar).

### 7. Diálogos de confirmación personalizados

Overlay con `backdrop-filter: blur(4px)` que reemplaza los `confirm()` nativos del navegador, proporcionando una experiencia visual coherente (usado en importación y simulación de pico).

### 8. Exportación a JSON

Botón 📥 que descarga un fichero `resource_monitor_<timestamp>.json` con todas las alertas, series temporales y datos de rollup visibles, incluyendo marca temporal de exportación.

### 9. Importación desde JSON

Botón 📤 que abre un selector de archivos. Tras confirmar, carga los datos del JSON y actualiza tablas y gráficas en la vista actual.

### 10. Gráficas Chart.js mejoradas

Las gráficas de línea ahora usan `fill: true` con fondos semitransparentes, colores de ejes/rejilla adaptativos al tema, y límite de ticks para evitar solapamiento.

### 11. Filtros y búsqueda en alertas

La pestaña Alertas dispone de un campo de búsqueda libre y un selector de severidad. El filtrado se aplica en memoria de forma instantánea.

### 12. Pills de severidad

Las severidades se muestran como píldoras coloreadas (`sev-warning` con fondo ámbar, `sev-critical` con fondo rojo), más visibles que el texto plano original.

### 13. Animaciones y micro-interacciones

`fadeIn` y `slideUp` en la entrada de paneles, pestañas y toasts. Las tarjetas KPI tienen transición `translateY(-2px)` al pasar el cursor. El punto de estado usa `pulse` CSS nativo.

### 14. Diseño responsivo

Tres puntos de ruptura: escritorio (6 columnas KPI + 2 columnas gráficas), tablet (≤ 1 100 px → 3 columnas KPI + gráficas apiladas) y móvil (≤ 700 px → 2 columnas KPI + controles apilados).
