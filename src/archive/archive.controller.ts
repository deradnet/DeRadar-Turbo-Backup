import { Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ArchiveService } from './archive.service';
import { Query } from '@nestjs/common';
import { Request } from 'express';
import { Response } from 'express';
import { SessionAuthGuard } from '../auth/session.guard';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AircraftTrackerService } from './aircraft-tracker.service';
import { PaginationDto } from './dto/pagination.dto';
import { TxIdDto } from './dto/tx-id.dto';
import { AuditLoggerService } from '../common/services/audit-logger.service';

@Controller('archive')
export class ArchiveController {
  constructor(
    private readonly archiveService: ArchiveService,
    private readonly httpService: HttpService,
    private readonly aircraftTrackerService: AircraftTrackerService,
    private readonly auditLogger: AuditLoggerService,
  ) {}

  /**
   * PUBLIC - Read-only endpoint for viewing data archive
   */
  @Get('all')
  async getAll(
    @Query() pagination: PaginationDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await this.archiveService.findAll({
      offset: pagination.offset,
      limit: pagination.limit,
      req,
    });
    if (req.accepts('html')) {
      res.render('pagination-dark', result);
    } else {
      res.json(result);
    }
  }

  /**
   * PUBLIC - Read-only endpoint for viewing encrypted data archive
   */
  @Get('encrypted/all')
  async getAllEncrypted(
    @Query() pagination: PaginationDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await this.archiveService.findAllEncrypted({
      offset: pagination.offset,
      limit: pagination.limit,
      req,
    });
    res.json(result);
  }

  /**
   * PUBLIC - Read-only endpoint for viewing individual transaction data
   */
  @Get(':txId')
  async getOne(@Param() params: TxIdDto): Promise<any> {
    const raw = await this.archiveService.getDataByTX(params.txId);
    if (!raw) {
      throw new Error('Transaction not found');
    }
    return JSON.parse(raw);
  }

  @UseGuards(SessionAuthGuard)
  @Post('test-parquet')
  async testParquetUpload(): Promise<any> {
    // Fetch live aircraft data
    const response = await firstValueFrom(
      this.httpService.get('https://antenna-1.derad.org/aircraft.json'),
    );
    const data = response.data;

    // Upload as Parquet
    const txId = await this.archiveService.uploadParquet(data);

    return {
      success: true,
      txId,
      message: 'Successfully uploaded aircraft data as Parquet to Arweave',
      url: `https://arweave.net/${txId}`,
      aircraftCount: data.aircraft.length,
    };
  }

  /**
   * Start real-time aircraft tracking
   * Polls aircraft.json every second and uploads changes per aircraft
   */
  @UseGuards(SessionAuthGuard)
  @Post('tracking/start')
  async startTracking(@Req() req): Promise<any> {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    const username = req.session?.user?.user?.username || 'unknown';

    try {
      await this.aircraftTrackerService.startTracking();

      // Log successful admin action
      this.auditLogger.logAdminAction(
        'START_TRACKING',
        username,
        ip,
        userAgent,
        '/archive/tracking/start',
        {
          message: 'Aircraft tracking started',
          info: 'System will poll every 1 second and upload changed aircraft to Arweave',
        },
        true,
      );

      return {
        success: true,
        message: 'Aircraft tracking started',
        info: 'System will poll every 1 second and upload changed aircraft to Arweave',
      };
    } catch (error) {
      // Log failed admin action
      this.auditLogger.logAdminAction(
        'START_TRACKING',
        username,
        ip,
        userAgent,
        '/archive/tracking/start',
        {
          error: error.message,
        },
        false,
      );
      throw error;
    }
  }

  /**
   * Stop real-time aircraft tracking
   */
  @UseGuards(SessionAuthGuard)
  @Post('tracking/stop')
  async stopTracking(@Req() req): Promise<any> {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    const username = req.session?.user?.user?.username || 'unknown';

    try {
      this.aircraftTrackerService.stopTracking();

      // Log successful admin action
      this.auditLogger.logAdminAction(
        'STOP_TRACKING',
        username,
        ip,
        userAgent,
        '/archive/tracking/stop',
        {
          message: 'Aircraft tracking stopped',
        },
        true,
      );

      return {
        success: true,
        message: 'Aircraft tracking stopped',
      };
    } catch (error) {
      // Log failed admin action
      this.auditLogger.logAdminAction(
        'STOP_TRACKING',
        username,
        ip,
        userAgent,
        '/archive/tracking/stop',
        {
          error: error.message,
        },
        false,
      );
      throw error;
    }
  }

  /**
   * Get tracking statistics (API endpoint)
   * PUBLIC - Read-only endpoint for public dashboard
   */
  @Get('tracking/stats')
  async getTrackingStats(): Promise<any> {
    const stats = await this.aircraftTrackerService.getStats();
    return {
      success: true,
      stats,
    };
  }

  /**
   * Dashboard UI - Real-time monitoring interface (embedded in iframe)
   */
  @UseGuards(SessionAuthGuard)
  @Get('tracking/dashboard')
  async getTrackingDashboard(@Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/html');
    res.send(this.getDashboardHTML());
  }

  /**
   * Test single aircraft upload
   */
  @UseGuards(SessionAuthGuard)
  @Post('test-single-aircraft')
  async testSingleAircraftUpload(): Promise<any> {
    // Fetch live aircraft data
    const response = await firstValueFrom(
      this.httpService.get('https://antenna-1.derad.org/aircraft.json'),
    );
    const data = response.data;

    // Get first aircraft
    const aircraft = data.aircraft[0];
    if (!aircraft) {
      return {
        success: false,
        message: 'No aircraft data available',
      };
    }

    // Upload single aircraft as Parquet
    const txId = await this.archiveService.uploadSingleAircraftParquet(
      aircraft,
      data.now,
    );

    return {
      success: true,
      txId,
      message: 'Successfully uploaded single aircraft as Parquet to Arweave',
      url: `https://arweave.net/${txId}`,
      aircraft: {
        hex: aircraft.hex,
        callsign: aircraft.flight,
        type: aircraft.t,
      },
    };
  }

  /**
   * Generate dashboard HTML
   */
  private getDashboardHTML(): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DeRadar Aircraft Tracking Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
            color: #333;
        }

        .dashboard {
            max-width: 1400px;
            margin: 0 auto;
        }

        .header {
            background: white;
            border-radius: 16px;
            padding: 30px;
            margin-bottom: 20px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
        }

        .header h1 {
            font-size: 32px;
            font-weight: 700;
            color: #667eea;
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 16px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: 600;
        }

        .status-running {
            background: #d4edda;
            color: #155724;
        }

        .status-stopped {
            background: #f8d7da;
            color: #721c24;
        }

        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            animation: pulse 2s infinite;
        }

        .status-running .status-dot {
            background: #28a745;
        }

        .status-stopped .status-dot {
            background: #dc3545;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 20px;
        }

        .card {
            background: white;
            border-radius: 16px;
            padding: 24px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            transition: transform 0.2s, box-shadow 0.2s;
        }

        .card:hover {
            transform: translateY(-4px);
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
        }

        .card-title {
            font-size: 14px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #888;
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .card-value {
            font-size: 36px;
            font-weight: 700;
            color: #333;
            margin-bottom: 8px;
        }

        .card-subtitle {
            font-size: 14px;
            color: #666;
        }

        .card-icon {
            font-size: 20px;
        }

        .progress-bar {
            width: 100%;
            height: 8px;
            background: #e9ecef;
            border-radius: 4px;
            overflow: hidden;
            margin-top: 12px;
        }

        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #667eea, #764ba2);
            transition: width 0.3s ease;
        }

        .queue-visual {
            display: flex;
            gap: 4px;
            margin-top: 12px;
            flex-wrap: wrap;
        }

        .queue-slot {
            width: 32px;
            height: 32px;
            border-radius: 6px;
            background: #e9ecef;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: 600;
            transition: all 0.3s;
        }

        .queue-slot.active {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            animation: processing 1.5s infinite;
        }

        .queue-slot.queued {
            background: #ffc107;
            color: #333;
        }

        @keyframes processing {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.1); }
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
            margin-top: 12px;
        }

        .stat-item {
            padding: 12px;
            background: #f8f9fa;
            border-radius: 8px;
        }

        .stat-label {
            font-size: 12px;
            color: #666;
            margin-bottom: 4px;
        }

        .stat-value {
            font-size: 18px;
            font-weight: 700;
            color: #333;
        }

        .controls {
            background: white;
            border-radius: 16px;
            padding: 24px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }

        .btn {
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }

        .btn-start {
            background: #28a745;
            color: white;
        }

        .btn-start:hover {
            background: #218838;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(40, 167, 69, 0.3);
        }

        .btn-stop {
            background: #dc3545;
            color: white;
        }

        .btn-stop:hover {
            background: #c82333;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(220, 53, 69, 0.3);
        }

        .btn-refresh {
            background: #667eea;
            color: white;
        }

        .btn-refresh:hover {
            background: #5568d3;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
        }

        .auto-refresh {
            margin-left: auto;
            display: flex;
            align-items: center;
            gap: 8px;
            color: #666;
        }

        .success-rate {
            font-size: 24px;
            font-weight: 700;
            margin-top: 8px;
        }

        .success-rate.high { color: #28a745; }
        .success-rate.medium { color: #ffc107; }
        .success-rate.low { color: #dc3545; }

        @media (max-width: 768px) {
            .grid {
                grid-template-columns: 1fr;
            }
            .stats-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="dashboard">
        <div class="header">
            <h1>
                DeRadar Aircraft Tracking Dashboard
                <span id="status-badge" class="status-badge">
                    <span class="status-dot"></span>
                    <span id="status-text">Loading...</span>
                </span>
            </h1>
            <p id="uptime" style="color: #666; margin-top: 8px;">Uptime: --</p>
        </div>

        <div class="grid">
            <!-- System Status Card -->
            <div class="card">
                <div class="card-title">
                    <span class="card-icon">🖥️</span>
                    System Status
                </div>
                <div class="card-value" id="poll-cycles">0</div>
                <div class="card-subtitle">Total Poll Cycles</div>
                <div class="stats-grid">
                    <div class="stat-item">
                        <div class="stat-label">Polls/Min</div>
                        <div class="stat-value" id="polls-per-min">0</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">Last Poll</div>
                        <div class="stat-value" id="last-poll">--</div>
                    </div>
                </div>
            </div>

            <!-- Aircraft Tracking Card -->
            <div class="card">
                <div class="card-title">
                    <span class="card-icon">✈️</span>
                    Aircraft Tracking
                </div>
                <div class="card-value" id="active-aircraft">0</div>
                <div class="card-subtitle">Currently Active</div>
                <div class="stats-grid">
                    <div class="stat-item">
                        <div class="stat-label">Total Tracked</div>
                        <div class="stat-value" id="total-tracked">0</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">In Cache</div>
                        <div class="stat-value" id="in-cache">0</div>
                    </div>
                </div>
            </div>

            <!-- Upload Queue Card -->
            <div class="card">
                <div class="card-title">
                    <span class="card-icon">📤</span>
                    Upload Queue
                </div>
                <div class="card-value" id="queue-size">0</div>
                <div class="card-subtitle">Waiting in Queue</div>
                <div class="queue-visual" id="queue-visual"></div>
                <div class="stats-grid" style="margin-top: 12px;">
                    <div class="stat-item">
                        <div class="stat-label">Active</div>
                        <div class="stat-value" id="active-uploads">0</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">Available Slots</div>
                        <div class="stat-value" id="available-slots">5</div>
                    </div>
                </div>
            </div>

            <!-- Upload Success Rate Card -->
            <div class="card">
                <div class="card-title">
                    <span class="card-icon">📊</span>
                    Upload Success Rate
                </div>
                <div class="success-rate high" id="success-rate">100%</div>
                <div class="progress-bar">
                    <div class="progress-fill" id="success-progress" style="width: 100%"></div>
                </div>
                <div class="stats-grid" style="margin-top: 12px;">
                    <div class="stat-item">
                        <div class="stat-label">Succeeded</div>
                        <div class="stat-value" id="uploads-succeeded">0</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">Failed</div>
                        <div class="stat-value" id="uploads-failed">0</div>
                    </div>
                </div>
            </div>

            <!-- Changes Detected Card -->
            <div class="card">
                <div class="card-title">
                    <span class="card-icon">🔄</span>
                    Changes Detected
                </div>
                <div class="card-value" id="total-changes">0</div>
                <div class="card-subtitle">Total Changes</div>
                <div class="stats-grid">
                    <div class="stat-item">
                        <div class="stat-label">New</div>
                        <div class="stat-value" id="total-new">0</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">Updates</div>
                        <div class="stat-value" id="total-updates">0</div>
                    </div>
                </div>
            </div>

            <!-- Performance Metrics Card -->
            <div class="card">
                <div class="card-title">
                    <span class="card-icon">⚡</span>
                    Performance
                </div>
                <div class="card-value" id="uploads-per-min">0</div>
                <div class="card-subtitle">Uploads per Minute</div>
                <div class="stats-grid">
                    <div class="stat-item">
                        <div class="stat-label">Retries</div>
                        <div class="stat-value" id="total-retries">0</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">Changes/Poll</div>
                        <div class="stat-value" id="changes-per-poll">0</div>
                    </div>
                </div>
            </div>
        </div>

        <div class="controls">
            <button class="btn btn-start" onclick="startTracking()">
                ▶️ Start Tracking
            </button>
            <button class="btn btn-stop" onclick="stopTracking()">
                ⏹️ Stop Tracking
            </button>
            <button class="btn btn-refresh" onclick="refreshStats()">
                🔄 Refresh Now
            </button>
            <div class="auto-refresh">
                <input type="checkbox" id="auto-refresh" checked>
                <label for="auto-refresh">Auto-refresh (2s)</label>
            </div>
        </div>
    </div>

    <script>
        let refreshInterval;

        async function refreshStats() {
            try {
                const response = await fetch('/archive/tracking/stats');
                const data = await response.json();

                if (data.success) {
                    updateDashboard(data.stats);
                }
            } catch (error) {
                console.error('Failed to fetch stats:', error);
            }
        }

        function updateDashboard(stats) {
            // System Status
            const statusBadge = document.getElementById('status-badge');
            const statusText = document.getElementById('status-text');
            if (stats.system.is_running) {
                statusBadge.className = 'status-badge status-running';
                statusText.textContent = 'Running';
            } else {
                statusBadge.className = 'status-badge status-stopped';
                statusText.textContent = 'Stopped';
            }

            document.getElementById('uptime').textContent = 'Uptime: ' + stats.system.uptime_formatted;
            document.getElementById('poll-cycles').textContent = stats.system.total_poll_cycles.toLocaleString();
            document.getElementById('polls-per-min').textContent = stats.performance.polls_per_minute;

            const lastPollTime = new Date(stats.system.last_poll_time);
            document.getElementById('last-poll').textContent = lastPollTime.toLocaleTimeString();

            // Aircraft
            document.getElementById('active-aircraft').textContent = stats.aircraft.currently_active.toLocaleString();
            document.getElementById('total-tracked').textContent = stats.aircraft.total_tracked_all_time.toLocaleString();
            document.getElementById('in-cache').textContent = stats.aircraft.in_memory_cache.toLocaleString();

            // Queue
            document.getElementById('queue-size').textContent = stats.queue.queue_size.toLocaleString();
            document.getElementById('active-uploads').textContent = stats.queue.active_uploads;
            document.getElementById('available-slots').textContent = stats.queue.available_slots;
            updateQueueVisual(stats.queue);

            // Uploads
            const successRate = stats.uploads.success_rate_percent;
            const successRateEl = document.getElementById('success-rate');
            successRateEl.textContent = successRate.toFixed(1) + '%';

            if (successRate >= 95) {
                successRateEl.className = 'success-rate high';
            } else if (successRate >= 80) {
                successRateEl.className = 'success-rate medium';
            } else {
                successRateEl.className = 'success-rate low';
            }

            document.getElementById('success-progress').style.width = successRate + '%';
            document.getElementById('uploads-succeeded').textContent = stats.uploads.total_succeeded.toLocaleString();
            document.getElementById('uploads-failed').textContent = stats.uploads.total_failed.toLocaleString();

            // Changes
            const totalChanges = stats.aircraft.total_new + stats.aircraft.total_updates + stats.aircraft.total_reappeared;
            document.getElementById('total-changes').textContent = totalChanges.toLocaleString();
            document.getElementById('total-new').textContent = stats.aircraft.total_new.toLocaleString();
            document.getElementById('total-updates').textContent = stats.aircraft.total_updates.toLocaleString();

            // Performance
            document.getElementById('uploads-per-min').textContent = stats.performance.uploads_per_minute;
            document.getElementById('total-retries').textContent = stats.uploads.total_retries.toLocaleString();
            document.getElementById('changes-per-poll').textContent = stats.performance.changes_per_poll;
        }

        function updateQueueVisual(queue) {
            const visual = document.getElementById('queue-visual');
            visual.innerHTML = '';

            const maxSlots = queue.max_concurrent;
            const activeCount = queue.active_uploads;
            const queuedCount = Math.min(queue.queue_size, 10); // Show max 10 queued

            // Active uploads
            for (let i = 0; i < activeCount; i++) {
                const slot = document.createElement('div');
                slot.className = 'queue-slot active';
                slot.textContent = '⚙️';
                visual.appendChild(slot);
            }

            // Available slots
            for (let i = activeCount; i < maxSlots; i++) {
                const slot = document.createElement('div');
                slot.className = 'queue-slot';
                slot.textContent = i + 1;
                visual.appendChild(slot);
            }

            // Queued items
            for (let i = 0; i < queuedCount; i++) {
                const slot = document.createElement('div');
                slot.className = 'queue-slot queued';
                slot.textContent = '⏳';
                visual.appendChild(slot);
            }

            if (queue.queue_size > 10) {
                const slot = document.createElement('div');
                slot.className = 'queue-slot queued';
                slot.textContent = '+' + (queue.queue_size - 10);
                visual.appendChild(slot);
            }
        }

        async function startTracking() {
            try {
                const response = await fetch('/archive/tracking/start', { method: 'POST' });
                const data = await response.json();
                if (data.success) {
                    alert('Tracking started successfully!');
                    refreshStats();
                }
            } catch (error) {
                alert('Failed to start tracking: ' + error.message);
            }
        }

        async function stopTracking() {
            try {
                const response = await fetch('/archive/tracking/stop', { method: 'POST' });
                const data = await response.json();
                if (data.success) {
                    alert('Tracking stopped successfully!');
                    refreshStats();
                }
            } catch (error) {
                alert('Failed to stop tracking: ' + error.message);
            }
        }

        // Auto-refresh toggle
        document.getElementById('auto-refresh').addEventListener('change', (e) => {
            if (e.target.checked) {
                startAutoRefresh();
            } else {
                stopAutoRefresh();
            }
        });

        function startAutoRefresh() {
            if (refreshInterval) clearInterval(refreshInterval);
            refreshInterval = setInterval(refreshStats, 2000);
        }

        function stopAutoRefresh() {
            if (refreshInterval) {
                clearInterval(refreshInterval);
                refreshInterval = null;
            }
        }

        // Initialize
        refreshStats();
        startAutoRefresh();
    </script>
</body>
</html>
    `;
  }
}
