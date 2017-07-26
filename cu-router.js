/**
 * 缓存？
 * init方法里hash变动检测
 * 状态管理？
 * hashChanged事件和popstate事件，在这里只管hash改变
 * 不去管html5
*/
(function (window, factory) {
  typeof exports === 'object' && typeof module !== 'undefined'
    ? module.exports = factory()
    : typeof define === 'function' && define.amd
      ? define(factory)
      : (window.cuRouter = factory());
})(window, function () {

  // 解析设置的路由规则 /a/:id，将a、id提取出来
  var hashReg = /[^\/:]+/g;

  // 全局路由器对象
  // el: 挂载路由的节点
  // rootRoute: 路由节点，第一层是#
  // availViews: 该路由下的所有路由视图
  var router;

  /**
   * 状态栈
   */
  var stateStack = [];
  var stateIndex = -1;
  var NOSTATE = -1;
  var needPushState = true;

  // 重定向匹配表
  var redirectTable = {};

  // 能否继续unmount，如果为false，unmount过程会停止，mount也不会执行
  var canUnmount = true;

  /**
   * hash栈，一个hash节点包含：
   * url: 请求的路由的url（可能带参数）;
   * route: 路由对象route;
   * view: 该路由挂载的路由视图
   * availViews: 该路由下的所有路由视图，和父路由没用到的路由视图
        name: 路由视图的name
        mounted: 该路由视图是否已经挂载路由
        view: 路由视图
   */
  var hashStack = [];
  /**
   * 默认的路有对象
   * url、template: 要挂载在路由视图的html模板、或者页面url
   * name: 该路由指定的路由视图
   * controller: 主要有三个生命周期函数，
       willRoute(data, next): 在挂载前的准备，主要是获取数据渲染模板
       mounted(view): 页面已经挂载
       willUnmount(view): 在卸载路由前触发
   * children: 子路由，结构和其他路由一样
   * path: 路由规则经过解析，获取的hash主体
   * params: 路由规则经过解析，获取的hash的参数
   */
  var defaultRoute = {
    name: '',
    path: '',
    params: [],
    url: '',
    template: '',
    controller: {
      willMount: defaultWillMount,
      mounted: noop,
      willUnmount: noop
    },
    children: {}
  };

  var mountQueue;

  /**
   * 状态管理，暂时没有用
   */
  var State = {
    PENDING: 0,
    SELECT: 1,
    UNMOUNT: 2,
    MOUNT: 3
  };
  var state = State.PENDING;

  /**
   * 创建路由对象
   * @param el, 要挂载路由的节点, 字符串或对象
   * @param routes, 路由对象
   */
  function cuRouter (el, routes) {
    isString(el) && (el = document.querySelector(el));

    router = this;
    router.availViews = [];
    router.el = el;
    router.rootRoute = extend({}, defaultRoute, {
      path: '#',
      params: [],
      // 键值对，key是路由的主体，是route的path属性
      children: initRoutes(routes)
    });

    init();
  }

  /**
   * TODO 要改成不使用递归
   * 将路由进行规范化，将路由的路由规则解析成路径和参数
   * @param routes, 路由规则
   * @return route, 解析后的路由
   */
  function initRoutes (routes) {
    var route = {};
    for(var key in routes) {
      var results = key.match(hashReg);
      var subRoute = routes[key];
      subRoute.path = results[0];
      subRoute.params = results.slice(1);
      subRoute.controller = extend({}, defaultRoute.controller, subRoute.controller);
      subRoute = extend({}, defaultRoute, subRoute);

      subRoute.children = initRoutes(subRoute.children);

      route[subRoute.path] = subRoute;
    }
    return route;
  }


  /**
   * TODO 1、要不要加上popstate的事件检测，现在的方法，完全不用html5；
   *      2、isHashChanged未实现
   * 初始化，
   * 创建route-view元素、寻找route-view存入router
   * 是否支持html5的history
   * url地址变化检测
   */
  function init () {
    document.createElement('router-view');
    addRouteView(router.el, router);

    // 是否支持html5的history
    router.historySupport = (window.history != null? window.history.pushState: null) != null;

    // url地址变化检测
    // if (router.historySupport) {
    //   window.onpopstate = popState;
    // } else
    if (('onhashchange' in window) && ((typeof document.documentMode === 'undefined') || document.documentMode === 8)) {
      window.onhashchange = hashChanged;
    } else {
      setInterval(function() {
        isHashChanged() && hashChanged();
      }, 150);
    }

    hashChanged();
  }

  /**
   * 在某个元素el里搜索route-view节点，放到hash栈节点里
   * 或者把根元素的路由视图放在router下
   * @param el, 要寻找route-view的节点
   * @param hashNode, 放可用路由视图的节点
   */
  function addRouteView (el, hashNode) {
    var views = el.querySelectorAll('route-view');
    for(var i = 0; i < views.length; i++) {
      hashNode.availViews.push({
        name: views[i].getAttribute('name') || '',
        mounted: false,
        view: views[i]
      });
    }
  }

  /**
   * 将一个带参数的hash进行解析
   * @param url, 要解析的url
   * @return {url, path, query}, {完整的url，url的主题路径，query参数对象}
   */
  function resolveUrl (url) {
    var params = url.split('?');
    var query = {};
    if (params.length > 1) {
      var queryStrs = params[1].split('&');
      for(var i in queryStrs) {
        var param = queryStrs[i].split('=');
        query[param[0]] = param[1];
      }
    }
    return {
      url: url,
      path: params[0],
      query: query
    };
  }

  /**
   * 在不支持hashchange事件时，使用定时器检查hash是否改变
   */
  function isHashChanged () {
    return false;
  }

  /**
   * 根据重定向表，将hash与它进行对比，返回重定向后的路径
   * @param hash，要重定向的路径
   * @return hash，与重定向表匹配后的路径
   */
  function redirectTo (hash) {
    var s = hash.split('?');
    for(var key in redirectTable) {
      if (key === s[0]) {
        return s.length > 1? redirectTable[key] + s[1]: redirectTable[key];
      }
    }
    return hash;
  }

  /**
   * 获取hash地址
   */
  function getHash () {
    var hash = location.hash;
    !hash && (hash = '#/');
    hash = redirectTo(hash);
    return hash;
  }

  /**
   * hash改变后触发，进入路由选择
   */
  function hashChanged () {
    state = State.SELECT;
    var hash = getHash();
    console.log(hash);
    if (needPushState) {
      stateStack.push({path: hash});
      stateIndex++;
    } else {
      needPushState = true;
    }
    var hashes = hash.split('/').slice(1).map(function (hash, index) {
      return resolveUrl(hash);
    });
    routeSelect(hashes);
  }

  /**
   * 路由选择，将要unmount的hashNode和要mount的hash提取出来，先unmount再mount
   * 对比新旧hash，如果一个结点不同，就会从该节点向下，作为unmount、mount的对象
   * @param hashes {url, path, query}, hash地址的数组
   */
  function routeSelect (hashes) {
    var currentRoute = router.rootRoute;

    // 判断节点和节点下的路由是否要unmount
    var tounmounthashnode = [];
    var toMountHashes = [];
    // 将路由栈中的hash节点的url和新改变的hash节点的url进行对比，
    // 只有不一样，该节点以及向下的所有节点，都要unmount或mount
    for(var i = 0; i < hashStack.length && i < hashes.length; i++) {
      if (hashStack[i].url !== hashes[i].url) {
        tounmounthashnode = hashStack.splice(
          i,
          hashStack.length - i
        );
        toMountHashes = hashes.slice(i);
        break;
      }
      currentRoute = currentRoute.children[hashes[i].path];
    }
    // 避免两个长短不同的地址在短的部分是相同的，在长地址剩余部分是不同的
    if (toMountHashes.length === 0 && hashes.length > hashStack.length) {
      toMountHashes = toMountHashes.concat(hashes.slice(hashStack.length));
    }
    if (tounmounthashnode.length === 0 && hashes.length < hashStack.length) {
      tounmounthashnode = tounmounthashnode.concat(hashStack.slice(hashes.length));
    }

    var unmount = unmountRoutes(tounmounthashnode);
    var mount =  mountRoutes(toMountHashes, currentRoute);
    unmount();
    if (canUnmount) {
      mount();
    }
  }

  /**
   * 对要卸载的hashNode进行处理，返回具体卸载路由的方法
   * 每个方法，会执行willUnmount方法，如果返回false，就停止unmount，同时下一步的mount也会停止
   * @param tounmounthashnode, 要unmount的hashNode
   * @return unmount，具体执行卸载节点的方法
   */
  function unmountRoutes (tounmounthashnode) {
    state = State.UNMOUNT;
    canUnmount = true;
    var unmount = fcompose.apply(
      null,
      tounmounthashnode.map(function (toUnmount, index) {
        // 让每个willUnmount 能调用所在controller中的方法
        return function () {
          if (canUnmount !== false) {
            var route = toUnmount.route;
            var canUnmount = route.controller.willUnmount(toUnmount.view);
            canUnmount !== false && onUnmount(toUnmount);
          }
        };
      })
    );
    return unmount;
  }
  /**
   * unmount一个hashNode，将路由视图进行情空
   * @param hashNode
   */
  function onUnmount (hashNode) {
    var views = hashNode.availViews;
    for(var i in views) {
      views[i].mounted = false;
      views[i].view.innerHTML = '';
    }
    views = [];
  }
  /**
   * 和unmountRoute相似，返回一个函数用来执行hash的装载
   * @param toMountHashes，要加载的hash节点
   * @param currentRoute, 当前的路由规则
   * @return mount
   */
  function mountRoutes (toMountHashes, currentRoute) {
    state = State.MOUNT;
    mountQueue = {
      state: stateStack[stateIndex] || {},
      nextMount: 0,
      needLoad: false,
      loadedUrl: [],
      trigger: trigger
    };
    mountQueue.mount = toMountHashes.map(function (hash, index, arr) {
      var lastRoute = currentRoute;
      currentRoute = currentRoute.children[hash.path];
      if (!currentRoute) {
        console.warn('route not found: ' + hash.path);
        arr.splice(index + 1);
        return noop;
      }

      for(var i = 0; i < currentRoute.params.length; i++) {
        hash.query[currentRoute.params[i]] = arr[index + i + 1].path;
      }
      arr.splice(index + 1, currentRoute.params.length);

      if (!currentRoute.template && currentRoute.url) {
        mountQueue.needLoad = true;
        mountQueue.loadedUrl.push(0);
        (function (currentRoute) {
          load(currentRoute.url, function (res, status, xhr) {
            if (status === 200) {
              currentRoute.template = res;
              mountQueue.loadedUrl[index] = 1;
              mountQueue.trigger();
            }
          });
        })(currentRoute);
      } else {
        mountQueue.loadedUrl.push(1);
      }

      return (function (route, hash, lastRoute) {
        return function (state) {
          willMount(route, hash, lastRoute, state);
        };
      })(currentRoute, hash, lastRoute);
    });

    return function () {
      mountQueue.trigger();
    };
  }

  /**
   * 触发mount方法的执行
   * 对加载url和使用模板，使用的方法不同
   */
  function trigger () {
    if (this.nextMount >= this.mount.length) {
      state = State.PENDING;
      return;
    }
    if (this.needLoad && this.loadedUrl[this.nextMount]) {
      this.mount[this.nextMount++](this.state);
    } else {
      this.mount[this.nextMount++](this.state);
    }
  }

  /**
   * 执行路由规则的willMount方法
   * @param route
   * @param hash
   * @param lastRoute
   * @param state
   */
  function willMount (route, hash, lastRoute, state) {
    route.controller.willMount(
      {
        tpl: route.template,
        query: hash.query,
        data: state.data
      },
      function (html, data) {
        onMount(html, hash, route, lastRoute);
        mountQueue.trigger();
      }
    );
  }

  /**
   * 在willMount之后执行，将路由挂载到某一个路由视图上，并将该路由下的路由视图提取出来
   * @param html
   * @param hash
   * @param route
   * @param lastRoute
   */
  function onMount (html, hash, route, lastRoute) {
    var views;
    var routeView;
    var hashNode = {url: hash.url, route: route, availViews: []};
    var lastRouteViews = [];
    if (hashStack.length > 0) {
        views = hashStack[hashStack.length - 1].availViews;
    }
    for(var i in views) {
      if (!routeView && !views[i].mounted && views[i].name === route.name) {
        routeView = views[i];
        routeView.mounted = true;
        routeView.view.innerHTML = html;

        addRouteView(routeView.view, hashNode);
        // 只有找到路由视图放路由，才把hash进栈
        hashNode.view = routeView.view.children[0];
        route.controller.mounted(hashNode.view.children[0]);
      } else if (!views[i].mounted) {
        lastRouteViews.push(views[i]);
      }
    }
    hashNode.availViews = lastRouteViews.concat(hashNode.availViews);
    hashStack.push(hashNode);
  }

 /**
  * 将多个对象合为一个对象
  * @param objs，要合成的对象，第一个是函数返回的对象
  * @return Object，合成完成的对象
  */
  function extend (obj) {
    for(var i = 1; i < arguments.length; i++) {
      for(var key in arguments[i]) {
        obj[key] = arguments[i][key];
      }
    }
    return obj;
  }
  /**
   * 函数组合，传入一个函数的数组，返回一个函数
   * 返回的函数将从按数组降序方向调用函数，前一个函数的结果作为后一个函数的参数
   */
  function fcompose () {
    var _funcs = Array.prototype.slice.call(arguments);
    return function () {
      var args = arguments;
      for (var i = _funcs.length - 1; i >= 0; i--) {
        _funcs[i] && (args = [_funcs[i].apply(this, args)]);
      }
      return args[0];
    };
  }
  /**
   * 和fcompose类似，函数组合，不同的在于，数组中的函数执行方向是数组的升序方向
   */
  function fsequence () {
    var _funcs = Array.prototype.slice.call(arguments);
    return function () {
      var args = arguments;
      for (var i = 0; i < _funcs.length; i++) {
        _funcs[i] && (args = [_funcs[i].apply(this, args)]);
      }
      return args[0];
    };
  }

  /**
   * TODO 路由的url还有想不到的地方
   * ajax的封装
   * @param url，请求的url
   * @param data，ajax请求传入的参数
   * @param cb，回调函数，会传入xhr.response、xhr.status、xhr
   */
  function load (url, data, cb) {
    if (isFunction(data)) {
      cb = data;
      data = {};
    }
    var xhr = null;
    if (window.XMLHttpRequest) {
      xhr = new XMLHttpRequest();
    } else{
      xhr = new ActiveXObject("Microsoft.XMLHTTP");
    }
    xhr.onreadystatechange = function() {
      if(this.readyState === 4) {
        cb(this.response, this.status, xhr);
      }
    };
    xhr.open('get', url, true);
    xhr.send(data);
  }

  // no operation
  function noop () { }

  /**
   * 默认的willMount方法，会直接调用next方法
   */
  function defaultWillMount (data, next) { next(data.tpl); }

  /**
   * 柯理化的类型检测方法
   * @param type, 要检测的类型，首字母默认大写
   * @return function，具体类型检测的方法
   */
  function isType (type) {
    type = type.slice(0, 1).toUpperCase() + type.slice(1);
    return function (obj) {
      return Object.prototype.toString.call(obj) === '[object ' + type + ']';
    };
  }
  var isString = isType('string');
  var isFunction = isType('Function');

  /**
   * 添加路由重定向选项
   * 如果不输入from，默认是 /
   * @param from, 要重定向的路径
   * @param to, 重定向的路径
   */
  cuRouter.redirect = function (from, to) {
    if (!to) {
      to = from;
      from = '#/';
    }
    from[0] !== '#' && (from = '#' + from);
    redirectTable[from] = '#' + to;
  };

  /**
   * 将传入的对象，转换成state对象
   * @param newPath, {path, query, param, data}
   * @return {pathStr, data}
   */
  function resolveState (newPath) {
    var data = newPath.data;
    var defaultPath = {
      data: {},
      path: '',
      query: {},
      params: []
    };
    newPath = extend({}, defaultPath, newPath);

    var pathStr = '#' + newPath.path;

    if (newPath.params) {
      var params = newPath.params;
      var paramStr = '';
      for(var key in params) {
        paramStr += '/' + params[key];
      }
      pathStr += paramStr;
    }
    if (newPath.query) {
      var querys = newPath.query;
      var queryStr = '';
      for(var key in querys) {
        queryStr += '&' + key + '=' + querys[key];
      }
      queryStr = '?' + queryStr.slice(1);
      pathStr += queryStr;
    }

    return {path: pathStr, data: data};
  }

  // TODO 对这些方法，加上html5的使用
  /**
   * 将解析的state，push、replace到state栈中
   * 再修改历史的state的指向
   */
  cuRouter.prototype.push = function (newPath) {
    var state = resolveState(newPath);
    stateStack.push(state);
    stateIndex++;
    needPushState = false;
    location.hash = state.path;
  };
  cuRouter.prototype.replace = function (newPath) {
    var state = resolveState(newPath);
    stateStack[stateStack.length - 1] = state;
    needPushState = false;
    location.hash = state.path;
  };

  /**
   * go、forward、back都会触发hashchange、popstate事件
   */
  cuRouter.prototype.go = function (n) {
    var k = stateIndex + n;
    if (k < stateStack.length) {
      stateIndex = k >= 0? k: NOSTATE;
    }
    needPushState = false;
    history.go(n);
  };
  cuRouter.prototype.forward = function () {
    if (stateIndex + 1 < stateStack.length) {
      stateIndex++;
    }
    needPushState = false;
    history.forward();
  };
  cuRouter.prototype.back = function () {
    stateIndex = stateIndex <= 0? -1: --stateIndex;
    needPushState = false;
    history.back();
  };

  return cuRouter;
});
