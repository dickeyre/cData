import _ from 'lodash';
import moment from 'moment';
import getCompanyId from '../eastwind/server/get_company_id';

module.exports = function ({ Plugin }) {
  const kbnBaseUrl = '/app/portal';
  return new Plugin({
    require: ['eastwind'],

    uiExports: {
      hacks: [
        'plugins/cluster_vis'
      ],

      links: [
        {
          id: 'cluster_vis',
          title: 'Clusters',
          url: `${kbnBaseUrl}#/clusters`,
          description: 'Clusters',
        }
      ],
    },

    init: function (server, options) {
      const client = server.plugins.elasticsearch.client;

      server.route({
        method: 'GET',
        path: '/cluster_centers',
        handler: function (request, reply) {
          const companyId = 70528;
          return client.search({
            index: `ml-${companyId}`,
            type: 'bisectingkmeans',
            sort: 'label'
          }).then(function (clusterResults) {
            const clusters = _.map(clusterResults.hits.hits, '_source');

            reply(clusters);
          });
        }
      });

      server.route({
        method: 'GET',
        path: '/cluster_ips/{date}',
        handler: function (request, reply) {
          const companyId = 70528;
          const latest = moment.utc(request.params.date);
          const historicalDayFilters = [];
          const latestFormatted = latest.format('YYYY-MM-DD');
          historicalDayFilters.push({
            bool: {
              must: [{
                term: {
                  date: latestFormatted
                }
              }]
            }
          });
          for (let i = 0; i < 7; i++) {
            latest.subtract(1, 'd');
            const latestFormatted = latest.format('YYYY-MM-DD');
            historicalDayFilters.push({
              bool: {
                must: [{
                  term: {
                    date: latestFormatted
                  }
                }]
              }
            });
          }
          const todaySearch = client.search({
            index: `ml-${companyId}`,
            type: 'label',
            body: {
              query: {
                bool: {
                  must: [{
                    term: {
                      date: request.params.date
                    }
                  }]
                }
              }
            },
            size: 10000
          });
          const historicalSearch = client.search({
            index: `ml-${companyId}`,
            type: 'label',
            body: {
              query: {
                bool: {
                  should: historicalDayFilters
                }
              },
              aggregations: {
                ips: {
                  terms: {
                    field: 'ip',
                    size: 10000
                  },
                  aggs: {
                    clusters: {
                      terms: {
                        field: 'label'
                      }
                    }
                  }
                }
              }
            },
            size: 0
          });
          return Promise.all([todaySearch, historicalSearch]).then(function ([todayResults, historicalResults]) {
            const ipClusters = {};
            _.each(historicalResults.aggregations.ips.buckets, bucket => {
              const clusters = _.map(bucket.clusters.buckets, d => { return { cluster: d.key, count: d.doc_count }; });
              ipClusters[bucket.key] = clusters;
            });

            const ips = _.map(todayResults.hits.hits, '_source');

            _.each(ips, ip => {
              if (_.has(ipClusters, ip.ip)) {
                ip.historicalClusters = ipClusters[ip.ip];
                ip.softCluster = _(ip.historicalClusters).map(d => d.cluster).sortBy().join('-');
              } else {
                console.log('missed ' + ip.ip);
              }
            });

            reply(ips);
          });
        }
      });
    }
  });
};
