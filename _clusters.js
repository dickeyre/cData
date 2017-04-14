import _ from 'lodash';
import d3 from 'd3';
import moment from 'moment';

import uiRoutes from 'ui/routes';
import uiModules from 'ui/modules';
import Notifier from 'ui/notify/notifier';

import d3Fisheye from 'd3-plugins-dist/dist/mbostock/fisheye/cjs';

import clusterTemplate from './_clusters.html';
import mds from './mds.js';
import Tsnejs from './tsne.js';

//import deviceNamesArray from './device_names.json';

const deviceNames = {};
/*
for (const deviceName of deviceNamesArray) {
  deviceNames[deviceName[0]] = deviceName[1];
}
*/

const showIpNodes = true;
const showSoftClusters = false;

const app = uiModules.get('app/clusters', [
  'kibana/notify',
  'kibana/courier'
]);

const time = moment().subtract(1, 'days');

app.service('clusters', function ($http, Promise) {
  const Clusters = {};

  const getClusters = function () {
    return $http.get('/cluster_centers').then(function (response) {
      return response.data;
    });
  };

  const getIps = function (date) {
    return $http.get('/cluster_ips/' + date.format('YYYY-MM-DD')).then(function (response) {
      return response.data;
    });
  };

  Clusters.getData = function () {
    return Promise.all([getClusters(), getIps(time)]);
  };

  Clusters.getIps = function (date) {
    return getIps(date);
  };

  return Clusters;
});

uiRoutes
.when('/clusters', {
  template: clusterTemplate
});

app.controller('ewnClusters', function ($scope, clusters) {
  const notify = new Notifier({
    location: 'Clusters'
  });

  $scope.date = time.format('YYYY-MM-DD');
  $scope.day = time.format('dddd');

  $scope.deviceNames = deviceNames;

  $scope.ips = [];
  $scope.apps = [];

  $scope.$watch('manualDate', function (date) {
    console.log(date);
    if (date && date.length === 10) {
      const newTime = moment(date);
      time.date(newTime.date());
      time.month(newTime.month());
      time.year(newTime.year());
      $scope.manualDate = '';
      newDay();
    }
  });

  const clusterNodes = [];
  const clusterFoci = {};
  const softClusterNodes = [];
  const ipNodes = [];
  let softClusterNodeNames = {};

  const width = 2000;
  const height = 1250;

  const fill = d3.scale.category20();

  const softClusterForce = d3.layout.force()
      .nodes(softClusterNodes)
      .gravity(0)
      .charge(0)
      .chargeDistance(0)
      .size([width, height])
      .on('tick', softClusterTick);

  const ipForce = d3.layout.force()
      .nodes(ipNodes)
      .gravity(0)
      .charge(-5)
      .chargeDistance(100)
      .size([width, height])
      .on('tick', ipTick);

  const fisheye = d3Fisheye.default.circular()
    .radius(.3)
    .distortion(500);

  const verticalScale = d3.scale.linear()
    .range([50, height - 50]);

  const horizontalScale = d3.scale.linear()
    .range([50, width - 50]);

  const appWidth = d3.scale.linear()
    .range([1, 250]);

  function softClusterTick(e) {
    const k = .1 * e.alpha;

    // Push nodes toward their designated focus.
    softClusterNodes.forEach(d => {
      d.clusters.forEach(cluster => {
        d.y += (clusterFoci[cluster].y - d.y) * k;
        d.x += (clusterFoci[cluster].x - d.x) * k;
      });
    });
  }

  function ipTick(e) {
    const k = .1 * e.alpha;

    // Push nodes toward their designated focus.
    ipNodes.forEach(d => {
      if (!d.fixed) {
        d.y += (clusterFoci[d.cluster].y - d.y) * k;
        d.x += (clusterFoci[d.cluster].x - d.x) * k;
      }
    });
  }

  console.time('all');
  clusters.getData().then(function ([clusterData, ipData]) {
    const type = 'tsne';

    console.log(clusterData);
    console.log(_.map(clusterData, 'distance.0'));
    const clusterLocations1 = mds.classic(_.map(clusterData, 'distance.0'), 2);
    console.log(clusterLocations1);

    console.time('tsne');
    const tsne = new Tsnejs.tSNE({ perplexity: 5 }); // eslint-disable-line new-cap
    tsne.initDataDist(_.map(clusterData, 'distance.0'));
    for (let tsneCount = 0; tsneCount < 1000; tsneCount++) {
      tsne.step();
    }

    const clusterLocations2 = tsne.getSolution();
    console.timeEnd('tsne');
    console.log(clusterLocations2);

    let clusterLocations;
    if (type === 'mds') {
      clusterLocations = clusterLocations1;
      // calculate the cluster closest to the most clusters
      const distanceSums = _(clusterData).map('distance.0').map(_.sortBy).map(d => _.take(d, d.length / 2)).map(_.sum).valueOf();
      let closestCluster = 0;
      let closestDistance = 10000;
      for (let distanceStep = 0; distanceStep < distanceSums.length; distanceStep++) {
        if (distanceSums[distanceStep] < closestDistance) {
          closestDistance = distanceSums[distanceStep];
          closestCluster = distanceStep;
        }
      }

      console.log(closestCluster, closestDistance, distanceSums);
      fisheye.focus(clusterLocations[closestCluster]);
    } else if (type === 'tsne') {
      clusterLocations = clusterLocations2;
    }

    const xValues = [];
    const yValues = [];
    for (let clusterStep = 0; clusterStep < clusterLocations.length; clusterStep++) {
      const normalPos = {
        x: clusterLocations[clusterStep][0],
        y: clusterLocations[clusterStep][1],
      };
      const pos = type === 'mds' ? fisheye(normalPos) : normalPos;
      console.log(clusterStep, normalPos, pos);
      xValues.push(pos.x);
      yValues.push(pos.y);
    }

    horizontalScale.domain([d3.min(xValues), d3.max(xValues)]);
    verticalScale.domain([d3.min(yValues), d3.max(yValues)]);

    for (let posStep = 0; posStep < xValues.length; posStep++) {
      clusterFoci[posStep] = {
        x: horizontalScale(xValues[posStep]),
        y: verticalScale(yValues[posStep])
      };

      clusterNodes.push({
        type: 'cluster',
        title: `Cluster ${posStep}`,
        id: posStep,
        cluster: posStep,
        radius: 8,//clusterData[posStep]['distance-avg'] * 10,
        raw: clusterData[posStep],
        x: clusterFoci[posStep].x,
        y: clusterFoci[posStep].y
      });
    }
    console.log(clusterFoci);

    mergeIps(ipData, true);
  });

  function calcApplications(applications, newApps, cluster, ip) {
    for (let appIdx = 0; appIdx < newApps.length; appIdx++) {
      const [application, appcount] = newApps[appIdx].split(':');
      if (!_.has(applications, application)) {
        applications[application] = {
          amount: 0,
          clusters: {},
          ips: {}
        };
      }
      applications[application].amount += +appcount;
      if (!_.has(applications[application].clusters, cluster)) {
        applications[application].clusters[cluster] = 0;
      }
      applications[application].clusters[cluster] += +appcount;

      if (!_.has(applications[application].ips, ip)) {
        applications[application].ips[ip] = 0;
      }
      applications[application].ips[ip] += +appcount;
    }
  }

  function mergeIps(ipData, initial) {
    if (ipData.length === 0) {
      return;
    }
    for (const clusterNode of clusterNodes) {
      clusterNode.ips = [];
      clusterNode.applications = {};
      clusterNode.centerApplications = {};
    }

    if (showSoftClusters) {
      softClusterNodeNames = {};
      let softClusterCount = 0;
      for (const ip of ipData) {
        if (!_.has(softClusterNodeNames, ip.softCluster)) {
          if (ip.softCluster.split('-').length > 1) {
            softClusterNodeNames[ip.softCluster] = softClusterCount;
            softClusterCount++;
          }
        }
      }

      softClusterNodes.length = 0;
      for (const softCluster of _.keys(softClusterNodeNames)) {
        softClusterNodes.push({
          type: 'softCluster',
          title: `Soft Cluster ${softCluster}`,
          id: softCluster,
          cluster: softCluster,
          clusters: softCluster.split('-'),
          radius: 8,
          ips: [],
          applications: {}
        });
      }
    }

    const ipMapping = {};
    ipNodes.forEach(ip => {
      ipMapping[ip.ip] = ip;
    });

    ipNodes.length = 0;

    for (const ip of ipData) {
      let isNewIp = true;
      let isClusterChanging = false;
      let x = clusterFoci[ip.label].x + (Math.floor(Math.random() * 50) - 25);
      let y = clusterFoci[ip.label].y + (Math.floor(Math.random() * 50) - 25);
      if (ipMapping[ip.ip]) {
        x = ipMapping[ip.ip].x;
        y = ipMapping[ip.ip].y;
        isNewIp = false;
        if (ipMapping[ip.ip].cluster !== ip.label) {
          isClusterChanging = true;
          x = clusterFoci[ip.label].x + (Math.floor(Math.random() * 50) - 25);
          y = clusterFoci[ip.label].y + (Math.floor(Math.random() * 50) - 25);
        }
      }
      ipNodes.push({
        ip: ip.ip,
        type: 'ip',
        cluster: ip.label,
        applications: ip.applications,
        isNewIp: isNewIp,
        isClusterChanging: isClusterChanging,
        fixed: !(isNewIp || isClusterChanging),
        raw: ip,
        x: x,
        y: y
      });
      if (showSoftClusters && ip.softCluster.split('-').length > 1) {
        const softClusterIdx = softClusterNodeNames[ip.softCluster];
        softClusterNodes[softClusterIdx].ips.push(ip);
        calcApplications(softClusterNodes[softClusterIdx].applications, ip.applications, ip.label, ip.ip);
      } else {
        clusterNodes[ip.label].ips.push(ip);
        calcApplications(clusterNodes[ip.label].applications, ip.applications, ip.label, ip.ip);
      }
      calcApplications(clusterNodes[ip.label].centerApplications, ip.applications, ip.label, ip.ip);
    }

    if (showSoftClusters) {
      console.time('softClusterForce');
      softClusterForce.start();
      for (let tickCount = 0; tickCount < 75; tickCount++) {
        softClusterForce.tick();
      }
      softClusterForce.stop();
      console.timeEnd('softClusterForce');
    }

    if (showIpNodes) {
      console.time('ipForce');
      ipForce.start();
      for (let tickCount = 0; tickCount < 150; tickCount++) {
        ipForce.tick();
      }
      ipForce.stop();
      console.timeEnd('ipForce');
    }

    buildNodesLinks();
  }

  const svg = d3.select('svg')
      .attr('width', width)
      .attr('height', height)
      .append('g');
      //.attr('transform', d => `translate(${width/2},${height/2})`)

  function buildNodesLinks() {

    const clusters = svg.selectAll('.cluster')
      .data(clusterNodes, d => d.id);

    const clustersEnter = clusters.enter().append('g')
      .attr('class', 'cluster')
      .attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');

    clustersEnter.append('circle')
      .attr('r', d => d.radius ? d.radius : 8)
      .style('fill', d => fill(d.cluster))
      .style('stroke', d => d3.rgb(fill(d.cluster)).darker(2))
      .on('mouseenter', d => {
        svg.selectAll(`.app-bar-${d.cluster}`)
          .classed('active-app-bar', true);
        svg.selectAll(`.app-text-${d.cluster}`)
          .classed('active-app-text', true);
        console.log('mouseenter-cluster', d);

        $scope.$apply(function () {
          $scope.cluster = d.cluster;
          $scope.apps = _.keys(d.applications);
          $scope.ips = d.ips;
        });
      })
      .on('mouseleave', d => {
        svg.selectAll(`.app-bar-${d.cluster}`)
          .classed('active-app-bar', false);
        svg.selectAll(`.app-text-${d.cluster}`)
          .classed('active-app-text', false);
      });

    clustersEnter.append('text')
      .attr('dx', 12)
      .attr('dy', '.35em')
      .text(d => d.id);

    const clustersUpdate = clusters
      .transition()
      .duration(3000);

    clustersUpdate
      .attr('cluster', d => d.cluster)
      .attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');

    clustersUpdate.select('circle')
      .attr('r', d => d.radius ? d.radius : 8)
      .style('fill', d => fill(d.cluster))
      .style('stroke', d => d3.rgb(fill(d.cluster)).darker(2));

    clustersUpdate.select('text')
      .text(d => d.id);

    clusters.exit()
      .transition()
      .duration(3000)
      .style('opacity', 0)
      .remove();

    if (showSoftClusters) {
      const softClusters = svg.selectAll('.softCluster')
        .data(softClusterNodes, d => d.id);

      const softClustersEnter = softClusters.enter().append('g')
        .attr('class', 'softCluster')
        .attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');

      softClustersEnter.append('circle')
        .attr('r', d => d.radius ? d.radius : 8)
        .style('fill', d => fill(d.cluster))
        .style('stroke', d => d3.rgb(fill(d.cluster)).darker(2))
        .on('mouseenter', d => {
          svg.selectAll(`.app-bar-${d.cluster}`)
            .classed('active-app-bar', true);
          svg.selectAll(`.app-text-${d.cluster}`)
            .classed('active-app-text', true);
          console.log('mouseenter-cluster', d);

          $scope.$apply(function () {
            $scope.cluster = d.cluster;
            $scope.apps = _.keys(d.applications);
            $scope.ips = d.ips;
          });
        })
        .on('mouseleave', d => {
          svg.selectAll(`.app-bar-${d.cluster}`)
            .classed('active-app-bar', false);
          svg.selectAll(`.app-text-${d.cluster}`)
            .classed('active-app-text', false);
        });

      softClustersEnter.append('text')
        .attr('dx', 12)
        .attr('dy', '.35em')
        .text(d => d.id);

      const softClustersUpdate = softClusters
        .transition()
        .duration(3000);

      softClustersUpdate
        .attr('cluster', d => d.cluster)
        .attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');

      softClustersUpdate.select('circle')
        .attr('r', d => d.radius ? d.radius : 8)
        .style('fill', d => fill(d.cluster))
        .style('stroke', d => d3.rgb(fill(d.cluster)).darker(2));

      softClustersUpdate.select('text')
        .text(d => d.id);

      softClusters.exit()
        .transition()
        .duration(3000)
        .style('opacity', 0)
        .remove();
    }

    if (showIpNodes) {
      const ips = svg.selectAll('.ip')
        .data(ipNodes, d => d.ip);

      const ipsEnter = ips.enter().append('g')
        .attr('class', 'ip')
        .attr('ip', d => d.ip)
        .attr('cluster', d => d.cluster)
        .attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');

      ipsEnter.append('circle')
        .attr('r', 4)
        .style('fill', d => d3.rgb(fill(d.cluster)).brighter(1))
        .style('stroke', d => d3.rgb(fill(d.cluster)).brighter(2))
        .on('mouseenter', d => {
          svg.selectAll(`.app-bar-${d.cluster}`)
            .classed('active-app-bar', true);
          svg.selectAll(`.app-text-${d.cluster}`)
            .classed('active-app-text', true);
          console.log('mouseenter-cluster', d);

          $scope.$apply(function () {
            $scope.cluster = d.cluster;
            $scope.apps = d.applications;
            $scope.ips = [d];
          });
        })
        .on('mouseleave', d => {
          svg.selectAll(`.app-bar-${d.cluster}`)
            .classed('active-app-bar', false);
          svg.selectAll(`.app-text-${d.cluster}`)
            .classed('active-app-text', false);
        });

      ipsEnter.append('text')
        .attr('dx', 12)
        .attr('dy', '.35em')
        .text(d => '');

      const ipsUpdate = ips
        .transition()
        .duration(3000);

      ipsUpdate
        .attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');

      ipsUpdate.select('circle')
        .attr('r', d => 4)
        .style('fill', d => d3.rgb(fill(d.cluster)).brighter(1))
        .style('stroke', d => d3.rgb(fill(d.cluster)).brighter(2))
        .filter(d => d.isClusterChanging)
        .attr('r', d => 8)
        .transition()
        .duration(500)
        .attr('r', d => 4);

      ips.exit()
        .transition()
        .duration(3000)
        .style('opacity', 0)
        .remove();
    }

    console.timeEnd('all');
  }

  $scope.prevDay = function () {
    time.subtract(1, 'd');
    newDay();
  };

  $scope.nextDay = function () {
    time.add(1, 'd');
    newDay();
  };

  function newDay() {
    console.time('all');
    console.time('query');
    clusters.getIps(time).then(function (ipData) {
      console.timeEnd('query');
      $scope.date = time.format('YYYY-MM-DD');
      $scope.day = time.format('dddd');
      mergeIps(ipData);
    });
  }
});
