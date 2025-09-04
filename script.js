// AWS Configuration and Initialization
const AWS_CONFIG = {
    region: 'eu-north-1',  // Remove the asterisk
    bucketName: 'aux-data-bucket'
};

// Initialize AWS SDK with Cognito credentials
async function initializeAWS(token) {
    if (!token) {
        throw new Error('Authentication token is required');
    }

    AWS.config.update({
        region: AWS_CONFIG.region,
        credentials: new AWS.CognitoIdentityCredentials({
            IdentityPoolId: 'eu-north-1:98c07095-e731-4219-bebe-db4dab892ea8',
            Logins: {
                'cognito-idp.eu-north-1.amazonaws.com/eu-north-1_V9kLPNVXl': token
            }
        })
    });

    // Wait for credentials to be initialized
    return new Promise((resolve, reject) => {
        AWS.config.credentials.get(err => {
            if (err) reject(err);
            else resolve(new AWS.S3());
        });
    });
}

class DashboardManager {
        constructor(token) {
        this.token = token;
        this.currentTab = 'planning';
        this.currentTimeframe = 'monthly';
        this.dateRange = {
            start: moment().subtract(30, 'days'),
            end: moment()
        };
        this.charts = {};
        this.data = {
            rawData: null,
            processedData: null
        };
        this.isLoading = false;
        this.lastUpdate = null;

        // Initialize components
        this.initializeComponents();
        this.setupEventListeners();
        this.loadInitialData();
    }

    // Component Initialization
    initializeComponents() {
        this.initializeDateRangePicker();
        this.initializeChartDefaults();
        this.setupLoadingIndicator();
        this.setupErrorHandling();
    }

    // Initialize Date Range Picker
    initializeDateRangePicker() {
        $('input[name="daterange"]').daterangepicker({
            startDate: this.dateRange.start,
            endDate: this.dateRange.end,
            ranges: {
                'Today': [moment(), moment()],
                'Yesterday': [moment().subtract(1, 'days'), moment().subtract(1, 'days')],
                'Last 7 Days': [moment().subtract(6, 'days'), moment()],
                'Last 30 Days': [moment().subtract(29, 'days'), moment()],
                'This Month': [moment().startOf('month'), moment().endOf('month')],
                'Last Month': [moment().subtract(1, 'month').startOf('month'), 
                             moment().subtract(1, 'month').endOf('month')]
            }
        }, (start, end) => {
            this.dateRange = { start, end };
            this.updateDashboard();
        });
    }

    // Initialize Chart.js Defaults
    initializeChartDefaults() {
        Chart.defaults.font.family = "'Segoe UI', 'Helvetica Neue', 'Arial', sans-serif";
        Chart.defaults.color = '#666666';
        Chart.defaults.responsive = true;
        Chart.defaults.maintainAspectRatio = false;
    }

    // Setup Event Listeners
    setupEventListeners() {
        // Tab navigation
        document.querySelectorAll('.main-nav a').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchTab(e.target.dataset.tab);
            });
        });

        // Timeframe selector
        document.getElementById('timeframe-select').addEventListener('change', (e) => {
            this.currentTimeframe = e.target.value;
            this.updateDashboard();
        });

        // Refresh button
        document.getElementById('refresh-data').addEventListener('click', () => {
            this.loadData();
        });

        // Export button
        document.getElementById('export-data').addEventListener('click', () => {
            this.exportDashboardData();
        });

        // Error message close button
        document.querySelector('.close-error')?.addEventListener('click', () => {
            this.hideError();
        });
    }

    // Loading Indicator Management
    setupLoadingIndicator() {
        this.loadingOverlay = document.getElementById('loading-overlay');
    }

    showLoading() {
        this.isLoading = true;
        this.loadingOverlay.classList.remove('hidden');
    }

    hideLoading() {
        this.isLoading = false;
        this.loadingOverlay.classList.add('hidden');
    }

    // Error Handling
    setupErrorHandling() {
        this.errorToast = document.getElementById('error-message');
    }

    showError(message) {
        const errorText = this.errorToast.querySelector('.error-text');
        errorText.textContent = message;
        this.errorToast.classList.remove('hidden');
        setTimeout(() => this.hideError(), 5000);
    }

    hideError() {
        this.errorToast.classList.add('hidden');
    }

async initialize() {
    try {
        this.s3 = await initializeAWS(this.token);
        // Now proceed with other initializations
        this.initializeComponents();
        this.setupEventListeners();
        await this.loadInitialData();
    } catch (error) {
        console.error('Failed to initialize dashboard:', error);
        throw error;
    }
}

    // Data Loading and Processing
    async loadInitialData() {
        try {
            this.showLoading();
            await this.loadData();
            this.updateDashboard();
        } catch (error) {
            console.error('Error loading initial data:', error);
            this.showError('Failed to load dashboard data');
        } finally {
            this.hideLoading();
        }
    }

    // Data Loading from AWS S3
    async loadData() {
        try {
            this.showLoading();

            // Load Excel files from S3
            const [projectStatus, issuesReport] = await Promise.all([
                this.loadExcelFromS3('MS_Project_Status.xlsx'),
                this.loadExcelFromS3('MS_Issues_Report.xlsx')
            ]);

            this.data.rawData = {
                projectStatus,
                issuesReport
            };

            this.data.processedData = this.processData(projectStatus, issuesReport);
            this.lastUpdate = new Date();
            document.getElementById('last-updated').textContent = this.lastUpdate.toLocaleString();

            this.updateDashboard();
        } catch (error) {
            console.error('Error loading data:', error);
            this.showError('Failed to load data from server');
        } finally {
            this.hideLoading();
        }
    }

    // Load Excel File from S3
    async loadExcelFromS3(filename) {
        try {
            const params = {
                Bucket: AWS_CONFIG.bucketName,
                Key: filename
            };

            const response = await this.s3.getObject(params).promise();
            const workbook = XLSX.read(response.Body, { type: 'array' });
            
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            return XLSX.utils.sheet_to_json(worksheet);
        } catch (error) {
            console.error(`Error loading ${filename}:`, error);
            throw new Error(`Failed to load ${filename}`);
        }
    }

    // Process Raw Data
    processData(projectStatus, issuesReport) {
        return {
            planning: this.processPlanningMetrics(projectStatus, issuesReport),
            productivity: this.processProductivityMetrics(projectStatus),
            program: this.processProgramMetrics(projectStatus),
            quality: this.processQualityMetrics(projectStatus, issuesReport)
        };
    }

    // Process Planning Metrics
    processPlanningMetrics(projectStatus, issuesReport) {
        const filteredProjects = this.filterDataByDateRange(projectStatus);
        
        return {
            projectVolume: this.calculateProjectVolume(filteredProjects),
            turnaroundTimes: this.calculateTurnaroundTimes(filteredProjects),
            statusOverview: this.calculateStatusOverview(filteredProjects)
        };
    }

    // Process Productivity Metrics
    processProductivityMetrics(projectStatus) {
        const filteredProjects = this.filterDataByDateRange(projectStatus);
        
        return {
            executionMetrics: this.calculateExecutionMetrics(filteredProjects),
            timelineAnalytics: this.calculateTimelineAnalytics(filteredProjects),
            resourceUtilization: this.calculateResourceUtilization(filteredProjects)
        };
    }

    // Process Program Metrics
    processProgramMetrics(projectStatus) {
        const filteredProjects = this.filterDataByDateRange(projectStatus);
        
        return {
            distribution: this.calculateProjectDistribution(filteredProjects),
            geographic: this.calculateGeographicAnalysis(filteredProjects),
            trends: this.calculateTrendAnalysis(filteredProjects)
        };
    }

    // Process Quality Metrics
    processQualityMetrics(projectStatus, issuesReport) {
        const filteredProjects = this.filterDataByDateRange(projectStatus);
        const filteredIssues = this.filterDataByDateRange(issuesReport);
        
        return {
            defects: this.calculateDefectMetrics(filteredIssues),
            quality: this.calculateQualityScores(filteredProjects),
            compliance: this.calculateComplianceMetrics(filteredProjects)
        };
    }

    // Data Calculation Methods
    calculateProjectVolume(projects) {
        const total = projects.length;
        const active = projects.filter(p => p.status === 'Active').length;
        const completed = projects.filter(p => p.status === 'Completed').length;
        
        return {
            total,
            active,
            completed,
            timeline: this.generateTimelineData(projects, 'volume')
        };
    }

    calculateTurnaroundTimes(projects) {
        const completedProjects = projects.filter(p => p.status === 'Completed');
        
        const turnaroundTimes = completedProjects.map(project => ({
            duration: moment(project.completionDate).diff(moment(project.startDate), 'days'),
            projectType: project.type
        }));

        return {
            average: this.calculateAverage(turnaroundTimes.map(t => t.duration)),
            byType: this.groupByProjectType(turnaroundTimes),
            timeline: this.generateTimelineData(completedProjects, 'turnaround')
        };
    }

    calculateStatusOverview(projects) {
        const statusCounts = projects.reduce((acc, project) => {
            acc[project.status] = (acc[project.status] || 0) + 1;
            return acc;
        }, {});

        return {
            counts: statusCounts,
            percentages: this.calculatePercentages(statusCounts),
            timeline: this.generateTimelineData(projects, 'status')
        };
    }

    // Utility Methods
    filterDataByDateRange(data) {
        return data.filter(item => {
            const itemDate = moment(item.date);
            return itemDate.isBetween(this.dateRange.start, this.dateRange.end, 'day', '[]');
        });
    }

    calculateAverage(numbers) {
        return numbers.reduce((acc, val) => acc + val, 0) / numbers.length;
    }

    calculatePercentages(counts) {
        const total = Object.values(counts).reduce((acc, val) => acc + val, 0);
        const percentages = {};
        
        for (const [key, value] of Object.entries(counts)) {
            percentages[key] = (value / total) * 100;
        }
        
        return percentages;
    }

    groupByProjectType(data) {
        return data.reduce((acc, item) => {
            if (!acc[item.projectType]) {
                acc[item.projectType] = [];
            }
            acc[item.projectType].push(item.duration);
            return acc;
        }, {});
    }

    generateTimelineData(data, metric) {
        // Group data by date and calculate metrics
        const timelineData = {};
        const dateFormat = this.getDateFormatForTimeframe();

        data.forEach(item => {
            const date = moment(item.date).format(dateFormat);
            if (!timelineData[date]) {
                timelineData[date] = [];
            }
            timelineData[date].push(item);
        });

        return timelineData;
    }

    // Chart Implementations
    initializeCharts() {
        // Planning Charts
        this.charts.projectVolume = this.createProjectVolumeChart();
        this.charts.turnaroundTimes = this.createTurnaroundTimesChart();
        this.charts.statusOverview = this.createStatusOverviewChart();

        // Productivity Charts
        this.charts.executionMetrics = this.createExecutionMetricsChart();
        this.charts.timelineAnalytics = this.createTimelineAnalyticsChart();
        this.charts.resourceUtilization = this.createResourceUtilizationChart();

        // Program Charts
        this.charts.projectDistribution = this.createProjectDistributionChart();
        this.charts.geographicAnalysis = this.createGeographicAnalysisChart();
        this.charts.trendAnalysis = this.createTrendAnalysisChart();

        // Quality Charts
        this.charts.defectTracking = this.createDefectTrackingChart();
        this.charts.qualityScores = this.createQualityScoresChart();
        this.charts.complianceMetrics = this.createComplianceMetricsChart();
    }

    createProjectVolumeChart() {
        const ctx = document.getElementById('projectVolumeChart').getContext('2d');
        return new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Total Projects',
                    borderColor: '#ff9900',
                    data: [],
                    tension: 0.4
                }, {
                    label: 'Active Projects',
                    borderColor: '#28a745',
                    data: [],
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top'
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            precision: 0
                        }
                    }
                }
            }
        });
    }

    createTurnaroundTimesChart() {
        const ctx = document.getElementById('tatChart').getContext('2d');
        return new Chart(ctx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: 'Average Turnaround Time (Days)',
                    backgroundColor: '#17a2b8',
                    data: []
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }

    // Dashboard Update Methods
    updateDashboard() {
        if (!this.data.processedData) return;

        switch (this.currentTab) {
            case 'planning':
                this.updatePlanningDashboard();
                break;
            case 'productivity':
                this.updateProductivityDashboard();
                break;
            case 'program':
                this.updateProgramDashboard();
                break;
            case 'quality':
                this.updateQualityDashboard();
                break;
        }
    }

    updatePlanningDashboard() {
        const planningData = this.data.processedData.planning;

        // Update Project Volume Chart
        this.updateProjectVolumeChart(planningData.projectVolume);

        // Update Turnaround Times Chart
        this.updateTurnaroundTimesChart(planningData.turnaroundTimes);

        // Update Status Overview Chart
        this.updateStatusOverviewChart(planningData.statusOverview);

        // Update Summary Metrics
        this.updatePlanningMetrics(planningData);
    }

    updateProjectVolumeChart(data) {
        const chart = this.charts.projectVolume;
        const timelineData = this.formatTimelineData(data.timeline);

        chart.data.labels = timelineData.labels;
        chart.data.datasets[0].data = timelineData.total;
        chart.data.datasets[1].data = timelineData.active;
        chart.update();
    }

    // Export Functionality
    exportDashboardData() {
        try {
            const exportData = this.prepareExportData();
            const timestamp = moment().format('YYYY-MM-DD_HH-mm');
            const filename = `dashboard_export_${timestamp}.xlsx`;

            this.exportToExcel(exportData, filename);
        } catch (error) {
            console.error('Export failed:', error);
            this.showError('Failed to export dashboard data');
        }
    }

    prepareExportData() {
        const { processedData } = this.data;
        
        return {
            'Project Volume': this.formatProjectVolumeForExport(processedData.planning.projectVolume),
            'Turnaround Times': this.formatTurnaroundTimesForExport(processedData.planning.turnaroundTimes),
            'Status Overview': this.formatStatusOverviewForExport(processedData.planning.statusOverview),
            // Add other metrics as needed
        };
    }

    exportToExcel(data, filename) {
        const workbook = XLSX.utils.book_new();

        // Create worksheets for each data section
        for (const [sheetName, sheetData] of Object.entries(data)) {
            const worksheet = XLSX.utils.json_to_sheet(sheetData);
            XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
        }

        // Save the workbook
        XLSX.writeFile(workbook, filename);
    }

    // Utility Methods for Data Formatting
    formatTimelineData(timelineData) {
        const sortedDates = Object.keys(timelineData).sort();
        const formattedData = {
            labels: sortedDates,
            total: [],
            active: []
        };

        sortedDates.forEach(date => {
            const dateData = timelineData[date];
            formattedData.total.push(dateData.length);
            formattedData.active.push(
                dateData.filter(item => item.status === 'Active').length
            );
        });

        return formattedData;
    }

    formatProjectVolumeForExport(data) {
        return Object.entries(data.timeline).map(([date, projects]) => ({
            Date: date,
            'Total Projects': projects.length,
            'Active Projects': projects.filter(p => p.status === 'Active').length,
            'Completed Projects': projects.filter(p => p.status === 'Completed').length
        }));
    }

    // Date Utility Methods
    getDateFormatForTimeframe() {
        switch (this.currentTimeframe) {
            case 'daily':
                return 'YYYY-MM-DD';
            case 'weekly':
                return 'YYYY-[W]WW';
            case 'monthly':
                return 'YYYY-MM';
            case 'quarterly':
                return 'YYYY-[Q]Q';
            case 'yearly':
                return 'YYYY';
            default:
                return 'YYYY-MM-DD';
        }
    }

    // Performance Optimization Methods
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    memoize(fn) {
        const cache = new Map();
        return (...args) => {
            const key = JSON.stringify(args);
            if (cache.has(key)) return cache.get(key);
            const result = fn.apply(this, args);
            cache.set(key, result);
            return result;
        };
    }

    // Additional Chart Implementations
    createExecutionMetricsChart() {
        const ctx = document.getElementById('executionChart').getContext('2d');
        return new Chart(ctx, {
            type: 'radar',
            data: {
                labels: ['Planning', 'Execution', 'Delivery', 'Quality', 'Timeline', 'Budget'],
                datasets: [{
                    label: 'Current Period',
                    data: [],
                    borderColor: '#ff9900',
                    backgroundColor: 'rgba(255, 153, 0, 0.2)'
                }, {
                    label: 'Previous Period',
                    data: [],
                    borderColor: '#232f3e',
                    backgroundColor: 'rgba(35, 47, 62, 0.2)'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    r: {
                        beginAtZero: true,
                        max: 100,
                        ticks: {
                            stepSize: 20
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: (context) => `${context.label}: ${context.formattedValue}%`
                        }
                    }
                }
            }
        });
    }

    createQualityScoresChart() {
        const ctx = document.getElementById('qualityScoreChart').getContext('2d');
        return new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Quality Score',
                    data: [],
                    borderColor: '#28a745',
                    fill: false,
                    tension: 0.4
                }, {
                    label: 'Target Score',
                    data: [],
                    borderColor: '#dc3545',
                    borderDash: [5, 5],
                    fill: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        ticks: {
                            callback: value => `${value}%`
                        }
                    }
                }
            }
        });
    }

    createGeographicAnalysisChart() {
        const ctx = document.getElementById('geoChart').getContext('2d');
        return new Chart(ctx, {
            type: 'bubble',
            data: {
                datasets: []
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'linear',
                        position: 'bottom',
                        title: {
                            display: true,
                            text: 'Project Volume'
                        }
                    },
                    y: {
                        type: 'linear',
                        title: {
                            display: true,
                            text: 'Success Rate (%)'
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const dataset = context.dataset;
                                const index = context.dataIndex;
                                return [
                                    `Region: ${dataset.label}`,
                                    `Volume: ${dataset.data[index].x}`,
                                    `Success Rate: ${dataset.data[index].y}%`,
                                    `Projects: ${dataset.data[index].r}`
                                ];
                            }
                        }
                    }
                }
            }
        });
    }

    // Advanced Data Processing Methods
    processGeographicData(projects) {
        const regionData = {};

        // Group projects by region
        projects.forEach(project => {
            if (!regionData[project.region]) {
                regionData[project.region] = {
                    totalProjects: 0,
                    successfulProjects: 0,
                    onTimeDelivery: 0,
                    totalBudget: 0,
                    actualCost: 0
                };
            }

            const region = regionData[project.region];
            region.totalProjects++;
            
            if (project.status === 'Completed' && project.qualityScore >= 90) {
                region.successfulProjects++;
            }

            if (project.deliveryDate <= project.plannedDeliveryDate) {
                region.onTimeDelivery++;
            }

            region.totalBudget += parseFloat(project.plannedBudget || 0);
            region.actualCost += parseFloat(project.actualCost || 0);
        });

        // Calculate metrics for each region
        return Object.entries(regionData).map(([region, data]) => ({
            region,
            successRate: (data.successfulProjects / data.totalProjects) * 100,
            onTimeRate: (data.onTimeDelivery / data.totalProjects) * 100,
            budgetVariance: ((data.actualCost - data.totalBudget) / data.totalBudget) * 100,
            projectVolume: data.totalProjects
        }));
    }

    calculateRiskMetrics(projects) {
        const riskData = {
            high: [],
            medium: [],
            low: []
        };

        projects.forEach(project => {
            const riskScore = this.calculateProjectRiskScore(project);
            if (riskScore >= 75) {
                riskData.high.push(project);
            } else if (riskScore >= 40) {
                riskData.medium.push(project);
            } else {
                riskData.low.push(project);
            }
        });

        return {
            riskDistribution: {
                high: riskData.high.length,
                medium: riskData.medium.length,
                low: riskData.low.length
            },
            riskTrend: this.calculateRiskTrend(projects),
            topRiskFactors: this.identifyTopRiskFactors(projects)
        };
    }

    calculateProjectRiskScore(project) {
        const weights = {
            timeline: 0.3,
            budget: 0.25,
            complexity: 0.2,
            dependencies: 0.15,
            resources: 0.1
        };

        const scores = {
            timeline: this.calculateTimelineRisk(project),
            budget: this.calculateBudgetRisk(project),
            complexity: this.evaluateComplexity(project),
            dependencies: this.evaluateDependencies(project),
            resources: this.evaluateResourceRisk(project)
        };

        return Object.entries(weights).reduce((total, [factor, weight]) => {
            return total + (scores[factor] * weight);
        }, 0);
    }

    // Interactive Feature Handlers
    setupInteractiveFeatures() {
        this.setupChartInteractions();
        this.setupFilterControls();
        this.setupExportOptions();
        this.setupDataRefresh();
    }

    setupChartInteractions() {
        Object.values(this.charts).forEach(chart => {
            chart.canvas.addEventListener('click', (event) => {
                const elements = chart.getElementsAtEventForMode(event, 'nearest', { intersect: true }, false);
                if (elements.length) {
                    this.handleChartClick(chart, elements[0]);
                }
            });
        });
    }

    handleChartClick(chart, element) {
        const datasetIndex = element.datasetIndex;
        const index = element.index;
        const value = chart.data.datasets[datasetIndex].data[index];
        
        // Show detailed view for clicked data point
        this.showDetailedView({
            label: chart.data.labels[index],
            value: value,
            dataset: chart.data.datasets[datasetIndex].label,
            additionalData: this.getAdditionalDataForPoint(chart.id, index)
        });
    }

    // Error Recovery Mechanisms
    async retryOperation(operation, maxRetries = 3, delay = 1000) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                if (attempt === maxRetries) throw error;
                await new Promise(resolve => setTimeout(resolve, delay * attempt));
            }
        }
    }

    handleDataLoadError(error) {
        console.error('Data loading error:', error);
        this.showError(`Failed to load data: ${error.message}`);
        
        // Attempt to load cached data
        const cachedData = this.loadFromCache();
        if (cachedData) {
            this.data = cachedData;
            this.updateDashboard();
            this.showError('Showing cached data due to loading error');
        }
    }

    // Cache Management
    saveToCache(data) {
        try {
            localStorage.setItem('dashboardData', JSON.stringify({
                timestamp: new Date().getTime(),
                data: data
            }));
        } catch (error) {
            console.warn('Failed to cache dashboard data:', error);
        }
    }

    loadFromCache() {
        try {
            const cached = localStorage.getItem('dashboardData');
            if (cached) {
                const { timestamp, data } = JSON.parse(cached);
                const age = (new Date().getTime() - timestamp) / (1000 * 60); // age in minutes
                if (age < 60) { // Cache valid for 1 hour
                    return data;
                }
            }
            return null;
        } catch (error) {
            console.warn('Failed to load cached data:', error);
            return null;
        }
    }

    // Performance Optimization Implementations
    class PerformanceMonitor {
        constructor() {
            this.metrics = {
                renderTimes: [],
                dataProcessingTimes: [],
                loadTimes: []
            };
            this.maxMetricsLength = 100;
        }

        startTimer(operation) {
            return {
                start: performance.now(),
                operation
            };
        }

        endTimer(timer) {
            const duration = performance.now() - timer.start;
            if (this.metrics[timer.operation]) {
                this.metrics[timer.operation].push(duration);
                if (this.metrics[timer.operation].length > this.maxMetricsLength) {
                    this.metrics[timer.operation].shift();
                }
            }
            return duration;
        }

        getAverageMetrics() {
            const averages = {};
            for (const [operation, times] of Object.entries(this.metrics)) {
                averages[operation] = times.reduce((a, b) => a + b, 0) / times.length;
            }
            return averages;
        }
    }

    // Data Validation and Sanitization
    class DataValidator {
        static validateProjectData(project) {
            const requiredFields = ['id', 'name', 'startDate', 'status', 'region'];
            const errors = [];

            // Check required fields
            requiredFields.forEach(field => {
                if (!project[field]) {
                    errors.push(`Missing required field: ${field}`);
                }
            });

            // Validate dates
            if (project.startDate && !moment(project.startDate).isValid()) {
                errors.push('Invalid start date');
            }
            if (project.endDate && !moment(project.endDate).isValid()) {
                errors.push('Invalid end date');
            }

            // Validate numeric values
            if (project.budget && isNaN(parseFloat(project.budget))) {
                errors.push('Invalid budget value');
            }

            return {
                isValid: errors.length === 0,
                errors
            };
        }

        static sanitizeData(data) {
            return data.map(item => ({
                ...item,
                name: this.sanitizeString(item.name),
                description: this.sanitizeString(item.description),
                budget: this.sanitizeNumber(item.budget),
                status: this.sanitizeString(item.status)
            }));
        }

        static sanitizeString(str) {
            if (!str) return '';
            return str.toString()
                .trim()
                .replace(/[<>]/g, '') // Remove potential HTML tags
                .slice(0, 1000); // Limit string length
        }

        static sanitizeNumber(num) {
            const parsed = parseFloat(num);
            return isNaN(parsed) ? 0 : parsed;
        }
    }

    // Advanced Filtering Mechanisms
    class DataFilter {
        constructor(data) {
            this.data = data;
            this.filters = new Map();
        }

        addFilter(key, predicate) {
            this.filters.set(key, predicate);
            return this;
        }

        removeFilter(key) {
            this.filters.delete(key);
            return this;
        }

        clearFilters() {
            this.filters.clear();
            return this;
        }

        apply() {
            return this.data.filter(item =>
                Array.from(this.filters.values())
                    .every(predicate => predicate(item))
            );
        }

        static createDateRangeFilter(startDate, endDate, dateField = 'date') {
            return item => {
                const itemDate = moment(item[dateField]);
                return itemDate.isBetween(startDate, endDate, 'day', '[]');
            };
        }

        static createStatusFilter(statuses) {
            return item => statuses.includes(item.status);
        }

        static createRegionFilter(regions) {
            return item => regions.includes(item.region);
        }
    }

    // Dashboard State Management
    class DashboardState {
        constructor() {
            this.state = {
                currentTab: 'planning',
                timeframe: 'monthly',
                dateRange: {
                    start: moment().subtract(30, 'days'),
                    end: moment()
                },
                filters: {},
                sortOrder: {},
                viewPreferences: {}
            };

            this.subscribers = new Set();
        }

        updateState(partial) {
            const oldState = { ...this.state };
            this.state = {
                ...this.state,
                ...partial
            };
            this.notifySubscribers(oldState);
        }

        subscribe(callback) {
            this.subscribers.add(callback);
            return () => this.subscribers.delete(callback);
        }

        notifySubscribers(oldState) {
            this.subscribers.forEach(callback => callback(this.state, oldState));
        }

        persistState() {
            try {
                localStorage.setItem('dashboardState', JSON.stringify(this.state));
            } catch (error) {
                console.error('Failed to persist dashboard state:', error);
            }
        }

        loadPersistedState() {
            try {
                const persisted = localStorage.getItem('dashboardState');
                if (persisted) {
                    this.state = {
                        ...this.state,
                        ...JSON.parse(persisted)
                    };
                }
            } catch (error) {
                console.error('Failed to load persisted dashboard state:', error);
            }
        }
    }

    // Additional Utility Functions
    class DashboardUtils {
        static formatCurrency(value, currency = 'USD') {
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: currency
            }).format(value);
        }

        static formatPercentage(value, decimals = 1) {
            return `${value.toFixed(decimals)}%`;
        }

        static formatDate(date, format = 'YYYY-MM-DD') {
            return moment(date).format(format);
        }

        static calculateGrowth(current, previous) {
            if (previous === 0) return null;
            return ((current - previous) / previous) * 100;
        }

        static generateTimeSlots(startDate, endDate, interval = 'day') {
            const slots = [];
            let current = moment(startDate);
            const end = moment(endDate);

            while (current.isSameOrBefore(end)) {
                slots.push(current.format('YYYY-MM-DD'));
                current = current.add(1, interval);
            }

            return slots;
        }

        static interpolateMissingValues(data, timeSlots, valueField) {
            const result = [];
            let lastValue = 0;

            timeSlots.forEach(slot => {
                const matchingData = data.find(d => d.date === slot);
                if (matchingData) {
                    lastValue = matchingData[valueField];
                    result.push({ date: slot, [valueField]: lastValue });
                } else {
                    result.push({ date: slot, [valueField]: lastValue });
                }
            });

            return result;
        }
    }

    // Initialize Dashboard with all components
    initializeDashboard() {
        this.performanceMonitor = new PerformanceMonitor();
        this.dashboardState = new DashboardState();
        this.dashboardState.loadPersistedState();

        // Initialize all components
        this.setupEventListeners();
        this.initializeCharts();
        this.setupInteractiveFeatures();

        // Load initial data
        this.loadInitialData().then(() => {
            console.log('Dashboard initialized successfully');
        }).catch(error => {
            console.error('Failed to initialize dashboard:', error);
            this.handleDataLoadError(error);
        });

        // Setup periodic refresh
        this.setupAutoRefresh();
    }

    setupAutoRefresh() {
        const refreshInterval = 5 * 60 * 1000; // 5 minutes
        setInterval(() => {
            this.loadData().catch(error => {
                console.error('Auto-refresh failed:', error);
            });
        }, refreshInterval);
    }
}

// Create and initialize dashboard instance
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Get authentication token (implement your auth logic here)
        const token = await AuthService.ensureAuthenticated();
        
        // Create and initialize dashboard
        window.dashboard = new DashboardManager(token);
        await window.dashboard.initialize();
        
        console.log('Dashboard initialized successfully');
    } catch (error) {
        console.error('Failed to initialize dashboard:', error);
        // Handle initialization error
    }
});

// Export the dashboard class for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DashboardManager;
}

