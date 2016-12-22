var app = null;

Ext.define("TSApp", {
extend: 'Rally.app.TimeboxScopedApp',
    componentCls: 'app',
    scopeType : 'iteration',
    items : [
        { xtype:'container',itemId:'settings_box'}
    ],

    config: {
        defaultSettings: {
            baselineType : 0,
            aggregateType : 'Count'
        }
    },
    devMode : false,
    fetch : ['FormattedID','ObjectID', '_ValidTo', '_ValidFrom', 'PlanEstimate',
        'Name','ActualEndDate','ActualStartDate','ScheduleState','Owner'],

    seriesKeys : ['BaselineScope','BaselineScopeInProgress','BaselineScopeCompleted','AddedScope','AddedScopeInProgress','AddedScopeCompleted'],

    isExternal: function(){
        return typeof(this.getAppId()) == 'undefined';
    },

    containsKey : function(bundle,key) {
        return (_.findIndex(_.keys(bundle),key) !== -1 )
    },

    _getRelease : function() {
        console.log("_getRelease");
        var deferred = Ext.create('Deft.Deferred');
        if (app.devMode===true) {
            deferred.resolve({
                release :  {
                        Name: "Release 2",
                        ReleaseDate: "2016-08-01T06:59:59.000Z",
                        ReleaseStartDate: "2016-05-01T06:00:00.000Z"
                        }
                }
            );
        } else {
            deferred.resolve({
                release : app.release
            });
        }
        return deferred.promise;
    },

    _loadPreliminaryEstimateValues : function(bundle) {
        app.showMask("loading timeboxes ...");
        console.log("_loadPreliminaryEstimateValues");
        var deferred = Ext.create('Deft.Deferred');

        if ( app.containsKey(bundle,"prelimEstimateValues")) {
            deferred.resolve(bundle)
        } else {
            app._loadAStoreWithAPromise( 
                'PreliminaryEstimate',
                true,
                []).then({
                    success : function(records) {
                        bundle["prelimEstimateValues"] = records;
                        app.bundle = bundle;
                        deferred.resolve(bundle);
                    }
                });
        }
        return deferred.promise;
    },  

    _loadPortfolioItemTypes : function(bundle) {
        console.log("_loadPortfolioItemTypes");
        var deferred = Ext.create('Deft.Deferred');

        if ( app.containsKey(bundle,"piTypes")) {
            deferred.resolve(bundle)
        } else {
            app._loadAStoreWithAPromise( 
                'TypeDefinition',
                true,
                [ { property:"Ordinal", operator:"!=", value:-1} ]).then({
                    success : function(records) {
                        bundle["piTypes"] = records;
                        deferred.resolve(bundle);
                    }
                });
        }
        return deferred.promise;

    },

    _loadReleases : function(bundle) {
        console.log("_loadReleases",bundle);
        var release = bundle.release;
        var deferred = Ext.create('Deft.Deferred');
        app._loadAStoreWithAPromise(
                "Iteration", 
                ["Name","StartDate","EndDate","Project"], 
                [{ property : "Name", operator : "=", value : release.Name }]
            ).then({
                success : function(records) {
                    bundle.releases = _.filter(records,function(r) {
                        return r.get("Name")===release.Name;
                    });
                    deferred.resolve(bundle);
                },
                failure : function(e) {
                    deferred.reject(e);
                }
            });
        return deferred.promise;
    },

    _loadIterations : function(bundle) {
        console.log("_loadIterations");
        var release = bundle.release;
        var deferred = Ext.create('Deft.Deferred');
        // model_name, model_fields, filters,ctx,order
        app._loadAStoreWithAPromise(
                "Iteration", 
                ["Name","StartDate","EndDate"], 
                [
                    { property : "EndDate", operator : "<=", value : release.EndDate },
                    { property : "EndDate", operator : ">", value : release.StartDate }                    
                ], {
                    projectScopeDown : false
                },
                "EndDate"
            ).then({
                success : function(records) {
                    //bundle.iterations = records;
                    bundle.iterations = _.sortBy(records,function(i){
                        return i.get("EndDate");
                    });

                    if (records.length>0)
                        deferred.resolve(bundle);
                    else
                        deferred.reject("No iterations found");
                },
                failure : function(e) {
                    deferred.reject(e);
                }
            });
        return deferred.promise;
    },

    _querySet : function() {

        var queryText = app.getSetting("queryText");

        return ( !_.isUndefined(queryText) && !_.isNull(queryText) && queryText != '')

    },

    _queryFeatures : function(bundle) {
        console.log("_queryFeatures");
        
        var deferred = new Deft.Deferred();
        var queryText = app.getSetting("queryText");
        console.log("QueryText",queryText,_.isNull(queryText));

        if ( !app._querySet() ) {
            deferred.resolve(bundle);
        } else {
            var filter = Ext.create('TSStringFilter',{query_string: queryText });

            Ext.create('Rally.data.WsapiDataStore',{
            model: 'HierarchicalRequirement',//_.first(bundle.piTypes).get("TypePath"),
            autoLoad: true,
            limit: 'Infinity',
            filters: [filter,
                { property : "Iteration.Name", operator : "=", value : bundle.release.Name }
            ],
            fetch: ['ObjectID','FormattedID'],
            listeners: {
                scope: this,
                load: function(store,items,successful,opts) {
                    console.log("wsapi load",successful,opts);
                    if ( successful ) {
                        console.log("query features",_.map(items,function(i){return i.get("FormattedID")}));
                        bundle.queryFeatureOids = _.map(items,function(i){return i.get("ObjectID")});
                        deferred.resolve(bundle);
                    } else {
                        deferred.reject("Error loading filter");
                    }
                }
            }
            });
        }
        return deferred.promise;
    },

    _getSnapshots : function(bundle) {
        console.log("_getSnapshots")
        var releases = bundle.releases;

        var parentRelease = _.find(releases,function(r){
            var objid = Number(_.last(r.get("Project")._ref.split("/")));   
            
            return objid === app.getContext().getProject().ObjectID ;
        });

        var find = {}
        // if query text is used that will override find
        if (app._querySet()) {
            find = {
                "ObjectID" : { "$in" : bundle.queryFeatureOids }
            }
        } else {
            find = {
                "Iteration" : { "$in" : _.map(releases,function(r){return r.get("ObjectID");})},
                "_TypeHierarchy" : { "$in" : ['HierarchicalRequirement'] }                
            }
        }

        var deferred = new Deft.Deferred();
        Ext.create('Rally.data.lookback.SnapshotStore', {
            autoLoad : true,
            limit: Infinity,
            listeners: {
                refresh: function(store) {
                    var snapshots = [];
                    for (var i = 0, ii = store.getTotalCount(); i < ii; ++i) {
                        snapshots.push(store.getAt(i).data);
                    }
                    bundle.snapshots = snapshots;
                    console.log("snapshots:",snapshots.length);
                    deferred.resolve(bundle);
                }
            },
            fetch: app.fetch,
            hydrate: ["Project","Owner","ScheduleState"],      
            find : find,
        });
        return deferred.getPromise();
    },

    _process : function(bundle) {

        var deferred = new Deft.Deferred();
        app.showMask("Processing snapshots...");

        // add a range object for each snapshot, we use it later to see if the day is in that range
        _.each(bundle.snapshots,function(s){
            s.range = moment.range(s._ValidFrom,s._ValidTo);
        });

        var dr = app.dateRange(bundle.release);
        // console.log(bundle.release,_.last(dr));
        // iterate each day of the release
        // data is an array of objects; each object is keyed by the category and the key value is the 
        // set of applicable features
        bundle.data = _.map(dr,function( day, index ) {
            // filter to just the snapshots for that day
            var daySnapshots = _.filter(bundle.snapshots,function(s){
                return day.within(s.range);
            });
            // group the snapshots by id (there may be more than one in each day)
            var groupedById = _.groupBy(daySnapshots,"ObjectID");
            // get just the last snapshot for each day
            var dayFeatures = _.map( _.keys(groupedById), function(key) {
                return _.last(_.sortBy(groupedById[key],function(s) { return moment(s._ValidFrom);}));
            });
            return dayFeatures;
        });
        console.log('_process',bundle);
        deferred.resolve(bundle);
        return deferred.promise;
    },

    _setBaseline : function(bundle) {

        var deferred = new Deft.Deferred();
        // construct the date range array (array of dates for the release)
        var dr = app.dateRange(bundle.release);
        // get todays index into the release
        // bundle.todayIndex = _.findIndex(dr, moment(moment().format("M/D/YYYY")));
        var today = moment();
        bundle.todayIndex = _.findIndex(dr, function(r) {
            return r.year() === today.year() && r.month() === today.month() && r.date() === today.date();
        } );
        // console.log("today",bundle.todayIndex);

        // get the index of the baseline date
        bundle.baselineIndex = app.getBaselineIndex(dr,bundle.iterations);
        // initiatlize the baseline (the set of features that exist on the baseline)
        bundle.baseline = _.clone(bundle.data[bundle.baselineIndex]);
        // get the set of indexes into release array that represent end dates of iterations
        bundle.iterationIndices = app.dateIndexes( dr, _.map(bundle.iterations,function(i){ return moment(i.raw.EndDate);}));

        deferred.resolve(bundle);
        return deferred.promise;
    },

    _categorize : function(bundle) {

        var categorize = function( feature, dayIndex ) {
            // this function categorizes a feature snapshot into one of the following categories
            // Scope, ScopeInProgress, ScopeCompleted
            // see if feature is in baseline
            var scopeFunction = function(feature) {
                var bIndex = _.findIndex(bundle.baseline,function(f){
                    return f.ObjectID === feature.ObjectID;
                });

                if (/*bundle.baseline.length>0 && */bIndex ==-1 && dayIndex >= bundle.baselineIndex) {
                    return "Added";
                } else {
                    return "Baseline";
                }
            };

            var progressFunction = function(feature) {

                if ((feature.ScheduleState == "Completed") || (feature.ScheduleState == "Accepted")) 
                    return "ScopeCompleted";
                if (feature.ScheduleState == "In-Progress") 
                    return "ScopeInProgress";
                return "Scope";
            };

            return scopeFunction(feature) + progressFunction(feature);
        };

        var deferred = new Deft.Deferred();
        var dr = app.dateRange(bundle.release);
        bundle.data = _.map(bundle.data,function( dayFeatures,index ) {
            return _.groupBy(dayFeatures, function(feature) {
                return categorize(feature,index);
            });
        });
        deferred.resolve(bundle);
        return deferred.promise;
    },

    // prepare the chart data by transforming the data array into a set of highcharts series objects
    _prepareChartData : function( bundle ) {

        var deferred = new Deft.Deferred();

        app.showMask("Preparing chart...");

        var reducerFunction = app.getReducerFunction();

        var series = _.map(app.seriesKeys,function(key){
            return {
                name : key,
                data : _.map( bundle.data, function(d,x){ 

                    // if no features for category return a null value
                    if (_.isUndefined(d[key]))  {
                        return { 
                            x : x, y : null, features : null
                        };
                    }

                    // return null value for future dates
                    if( (bundle.todayIndex >= 0) && (x > bundle.todayIndex+1)) {
                        return { 
                            x : x, y : null, features : null
                        };
                    }

                    // calculate the value by aggregating the features
                    var value = reducerFunction( d[key] );
                    // if it's not baseline multiply by -1 so it is shown below the x-axis
                    // value = key.startsWith("Baseline") ? value : value * -1;                        
                    // value = key.includes("Baseline") ? value : value * -1;                        
                    value = (key.indexOf("Baseline") > -1) ? value : value * -1;                        

                    return {
                        x : x, y : value, features : d[key]
                    };
            })
        };
        });
        bundle.chartData = { series : series };
        deferred.resolve( bundle ) ;
        return deferred.promise;
    },


    _createChart : function( bundle ) {

        app.hideMask();
        var deferred = new Deft.Deferred();

        if (!_.isUndefined(app.chart)) {
            app.remove(app.chart);
        }

        app.chart = Ext.create('Rally.technicalservices.scopeChangeChart', {
            itemId: 'rally-chart',
            chartData: bundle.chartData,
            iterationIndices : bundle.iterationIndices,
            baselineIndex : bundle.baselineIndex,
            subtitle : app.getSetting('queryDescription'),
            app : app,
            listeners : {
                // called when user clicks on a series in the chart
                series_click : app.showItemsTable,
                scope : app
            }
        });
        app.add(app.chart);
        deferred.resolve(bundle);
        return deferred.promise;
    },

    onScopeChange : function( scope ) {
        // grab just the release data
        app = this;
        console.log("onScopeChange");
        this.release = !_.isUndefined(scope) ? scope.getRecord().raw : null;
        this.clear();
        app.bundle = {};

        Deft.Chain.pipeline([
            this._getRelease,
            this._loadPreliminaryEstimateValues,
            this._loadPortfolioItemTypes,
            this._loadReleases,
            this._loadIterations,
            this._queryFeatures,
            this._getSnapshots,
            this._process,
            this._setBaseline,
            this._categorize,
            this._prepareChartData,
            this._createChart
        ]).then({
            success : function(res) {
                // console.log("res",res);
                app.bundle = res;
            },
            failure : function(res) {
                console.log("failure",res);
                app.add({text:res});
            }
        });

    },

    // remove the extjs components from the page
    clear : function() {
        var that = this;
        if (!_.isUndefined(that.itemsTable)) {
            that.remove(that.itemsTable);
        }
        if (!_.isUndefined(that.scopeGrid)) {
            that.remove(that.scopeGrid);
        }
        if (!_.isUndefined(that.chart)) {
            that.remove(that.chart);
        }
        if (!_.isUndefined(that.tabPanel)) {
            that.remove(that.tabPanel);
        }

    },

    // The release is an array of dates; find the index of the date for the baseline. 
    // The baseline date is based on the selected configuration
    getBaselineIndex : function(range,iterations) {

        // if (app.getSetting("baselineType") ==='End of first Day') {
        //     return 0;
        // }
        // if (app.getSetting("baselineType") ==='End of first Sprint') {
        //     var iterationEndDate = moment( moment(_.first(iterations).raw.EndDate).format("M/D/YYYY"));
        //     var x = _.findIndex(range, function(r) {
        //         return r.format() === iterationEndDate.format();
        //     } );
        //     return x;
        // }
        return app.getSetting("baselineType");
    },

    // returns an array of features that have been added or removed since the baseline
    getScopeChangeFeatures : function(chart,x) {

        var that = this;

        // aggregate the features for all series for the selected data
        var currentFeatures = _.compact(_.flatten(_.map(chart.series,function(s) { return s.data[x].features })));
        var previousFeatures = app.bundle.baseline;

        // get feature ids for comparison
        var cFeatures = _.map( currentFeatures, function(f) { return f.FormattedID; });
        var pFeatures = _.map( previousFeatures, function(f) { return f.FormattedID; });

        var removed = _.difference(pFeatures, cFeatures);
        var added = _.difference(cFeatures, pFeatures);

        var findit = function( features, fid ) {
            return _.find( features, function(f){ return f.FormattedID === fid; });
        }

        var r = _.map ( removed, function(fid) { 
            var f = findit(previousFeatures,fid);
            f["Scope"] = "Removed";
            return f;
        });

        var a = _.map ( added, function(fid) { 
            var f = findit(currentFeatures,fid);
            f["Scope"] = "Added";
            return f;
        })

        return a.concat(r);

    },

    addScopeChangeTable : function( features, day ) {

        var that = this;

        // create the data store
        var store = new Ext.data.ArrayStore({
            fields: [
                {name: 'Scope'},
                {name: 'FormattedID' },
                {name: 'Project' },
                {name: 'Name' },
                {name: 'ScheduleState' },
                //{name: 'Owner' },
                {name: 'PlanEstimate' }
            ]
        });
        store.loadData(features);

        var grid = new Ext.grid.GridPanel({
            store: store,
            columns: [
                { header: "Scope", sortable: true, dataIndex: 'Scope', flex:1},
                { header: "ID", sortable: true, dataIndex: 'FormattedID', flex:1},
                { header: "Project", sortable: true, dataIndex: 'Project', flex:1,
                  renderer: function(Project) {
                      return Project.Name;
                  }
                },
                { header: "Name", sortable: true, dataIndex: 'Name', width:250, flex:1},
                { header: "ScheduleState", sortable: true, dataIndex: 'ScheduleState', flex:1},
                // { header: "Owner", sortable: true, dataIndex: 'Owner', flex:1,
                //     renderer: function(Owner) {
                //         return Owner.FirstName;
                //     }
                // },
                { header: "Size", sortable: true, dataIndex: 'PlanEstimate', flex:1 
                    //,
                    // renderer : function(value, p, record){
                    //     var estimate = _.find(app.bundle.prelimEstimateValues,function(v) {
                    //         return value === v.get("ObjectID");
                    //     });
                    //     return estimate ? estimate.get("Name") + " (" + estimate.get("Value") + ")" : "(None)";
                    // }
                }
            ],
            stripeRows: true,
            title:'Scope Change Since Baseline for Day: ' + day,
        });

        // that.add(grid);
        return grid;
    },

    // returns a function to aggregate the features based on the app configuration
    getReducerFunction : function() {

        var that = this;
        var reducerFn = null;

        // simple count of features
        var countReducer = function(features) {
            return features.length;
        };

        // sum of story points for the features
        var pointsReducer = function(features) {
            return _.reduce(features,function(memo,feature) { 
                return memo + feature.PlanEstimate; }, 0 );
        };

        // sum of preliminary estimate values for the features
        var estimateReducer = function(features) {
            return _.reduce(features,function(memo,feature) { 
                var estimate = _.find(app.bundle.prelimEstimateValues,function(v) {
                    return feature.PreliminaryEstimate === v.get("ObjectID");
                });
                return memo + (_.isUndefined(estimate) ? 0 : estimate.get("Value")); 
            }, 0 );
        };

        switch( that.getSetting('aggregateType') ) {
            case 'Points': reducerFn = pointsReducer; break;
            case 'Count': reducerFn = countReducer; break;
            case 'Preliminary Estimate': reducerFn = estimateReducer; break;
        }

        return reducerFn;

    },

    // create a filter for showing a set of features based on their object id's
    createFilterFromFeatures : function(features) {

        var filter = null;
        _.each(features,function(f){
            filter = filter === null ?
                Ext.create('Rally.data.wsapi.Filter', {
                    property: 'ObjectID', operator: '=', value: f.ObjectID
                }) :
                filter.or( {
                    property: 'ObjectID', operator: '=', value: f.ObjectID
                });
        });
        return filter;
    },

    // called when a data value is clicked. Shows a grid of the features that make up that data point.
    showItemsTable : function( event ) {
        var that = this;

        var scopeChangeFeatures = that.getScopeChangeFeatures(event.series.chart,event.x);
        that.scopeGrid = that.addScopeChangeTable(scopeChangeFeatures,event.x);

        if (!_.isUndefined(that.tabPanel)) {
            that.remove(that.tabPanel);
        }

        var filter = that.createFilterFromFeatures(event.features);

        Ext.create('Rally.data.wsapi.TreeStoreBuilder').build({
            // models: ['PortfolioItem/Feature'],
            models: ['HierarchicalRequirement'],//[_.first(app.bundle.piTypes).get("TypePath")],
            filters : [filter],
            autoLoad: true,
            enableHierarchy: true,
            enablePostGet : true,
            enableRootLevelPostGet : true,
            listeners : {
                load : function(a,b,c) {
                }
            },
        }).then({
            success: function(store) {
                // remove table if it already exists
                if (!_.isUndefined(that.itemsTable)) {
                    that.remove(that.itemsTable);
                }
                that.itemsTable = Ext.create('Rally.ui.grid.TreeGrid',{
                    xtype: 'rallytreegrid',
                    store: store,
                    context: that.getContext(),
                    enableEditing: false,
                    enableBulkEdit: false,
                    shouldShowRowActionsColumn: false,
                    enableRanking: false,
                    columnCfgs: [
                        'Project','Name','ScheduleState', 'Owner', 'PlanEstimate'
                    ]
                });

                that.tabPanel = Ext.create('Ext.tab.Panel', {
                    items: [{
                        title: 'Series',
                        items : [that.itemsTable]
                    }, {
                        title: 'Change',
                        items : [that.scopeGrid]
                    }]
                });

                that.add(that.tabPanel);
            }
        });
    },

    // returns an array of indexes for a set of dates in a range
    dateIndexes : function(range,dates) {
        var that = this;
        var indices = [];
        var normDates = _.map(dates,function(d){ return moment(d.format("M/D/YYYY"));});

        _.each(range,function(day,i){
            var d = moment(day.format("M/D/YYYY"));
            var x = _.findIndex(normDates,d);
            if (x !== -1) indices.push(i);
        });
        return indices;
    },

    dateRange : function(release) {
        var dr = [];
        var range = moment.range( moment(release.StartDate), moment(release.EndDate) );
        range.by('days',function(m) {
            dr.push( moment(m.format("M/D/YYYY")));
        },false);
        return dr;
    },

    _loadAStoreWithAPromise: function( model_name, model_fields, filters,ctx,order) {

        var deferred = Ext.create('Deft.Deferred');
        var me = this;

        var config = {
            model: model_name,
            fetch: model_fields,
            filters: filters,
            limit: 'Infinity'
        };
        if (!_.isUndefined(ctx)&&!_.isNull(ctx)) {
            config.context = ctx;
        }
        if (!_.isUndefined(order)&&!_.isNull(order)) {
            config.order = order;
        }

        Ext.create('Rally.data.wsapi.Store', config ).load({
            callback : function(records, operation, successful) {
                if (successful){
                    deferred.resolve(records);
                } else {
                    deferred.reject('Problem loading: ' + operation.error.errors.join('. '));
                }
            }
        });
        return deferred.promise;
    },

    getSettingsFields: function() {

        var aggregateStore = new Ext.data.ArrayStore({
            fields: ['aggregate'],
            data : [['Count'],['Points']]
        });  

        var baselineTypeStore = new Ext.data.ArrayStore({
            fields: ['baselineType'],
            data : [["0"],["1"],["2"],["3"],["4"] /*,['Day Index'],['Specific Date']*/ ]
        });  

        return [ 
            {
                name: 'aggregateType',
                xtype: 'combo',
                store : aggregateStore,
                valueField : 'aggregate',
                displayField : 'aggregate',
                queryMode : 'local',
                forceSelection : true,
                boxLabelAlign: 'after',
                fieldLabel: 'Aggregate Type',
                margin: '0 0 15 50',
                labelStyle : "width:200px;",
                afterLabelTpl: 'Choose <span style="color:#999999;"><i>Count</i> or <i>points</i></span>'
            },
            {
                name: 'baselineType',
                xtype: 'combo',
                store : baselineTypeStore,
                valueField : 'baselineType',
                displayField : 'baselineType',
                queryMode : 'local',
                forceSelection : true,
                boxLabelAlign: 'after',
                fieldLabel: 'Baseline Day',
                margin: '0 0 15 50',
                labelStyle : "width:200px;",
                afterLabelTpl: 'Choose <span style="color:#999999;"><i>Count</i> or <i>points</i></span>'
            },
            {
                name: 'queryDescription',
                xtype: 'rallytextfield',
                boxLabelAlign: 'after',
                fieldLabel: 'Query Label',
                margin: '0 0 15 50',
                labelStyle : "width:200px;",
                afterLabelTpl: 'Description of query to show on chart.'
            },
            {
                name: 'queryText',
                xtype:'textareafield',
                grow: true,
                width : 250,
                boxLabelAlign: 'after',
                fieldLabel: 'Query',
                margin: '0 0 15 50',
                labelStyle : "width:200px;",
                afterLabelTpl: 'Query to apply to the list of features.'
            }

        ];
    },

    showMask: function(msg) {
        if ( app.getEl() ) { 
            app.getEl().unmask();
            app.getEl().mask(msg);
        }
    },

    hideMask: function() {
        app.getEl().unmask();
    },

    getOptions: function() {
        return [
            {
                text: 'About...',
                handler: this._launchInfo,
                scope: this
            }
        ];
    },
    
    _launchInfo: function() {
        if ( this.about_dialog ) { this.about_dialog.destroy(); }
        this.about_dialog = Ext.create('Rally.technicalservices.InfoLink',{});
    },
    
    isExternal: function(){
        return typeof(this.getAppId()) == 'undefined';
    }
    
});
