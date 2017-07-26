(function (window, factory) {
  typeof exports === 'object' && typeof module !== 'undefined'
    ? module.exports = factory()
    : typeof define === 'function' && define.amd
      ? define(factory)
      : (window.Router = factory());
})(window, function () {
  var Router;

  function Route (path, fns) {
    // /api/a/{name}/b{base}
    !isArray(fns) && (fns = isFunction(fns)? [fns]: []);

    this.path = path;
    // 路由的参数名数组，数组中的顺序就是路由从左到右的顺序
    this.params = [];
    // 值为 function 或 array
    // onMount函数调用过程中，如果返回false，就停止
    this.onMount = [];
    this.mounted = fns;
    // onUnmount函数调用过程中，如果返回false，就停止
    this.onUnmount = [];

    var self = this;
    // 获取路由中的参数
    path.replace(/\{([_a-zA-Z]+)\}/g, function () {
      self.params.push(arguments[1]);
    });

    /**
     * 加载该路由
     * 如果，onmount返回false，就停止停止调用onmount，不允许加载
     */
    this.mount = function (routeParam) {
      // 有onmount就是执行onmount，如果一个返回false，就不允许加载
      if (this.onMount.length > 0) {
        // 第一个函数的输入是路由的参数
        // 第二个之后的函数参数是前一个的返回
        var result = routeParam;
        for (var i in this.onMount) {
          // 如果不是函数，或者函数返回false，就为false
          // 否则就作为下一次函数调用的参数
          result = isFunction(this.onMount[i]) && this.onMount[i].call(this, result);
          if (result === false) {
            // 停止mount
            return false;
          }
        }
      }
      // 调用mounted函数
      fsequence.apply(this, this.mounted)(routeParam);
    };
    /**
     * 卸载该路由
     * 如果一个onunmount返回false，就停止unmount
     */
    this.unmount = function () {
      // onUnmount 中有函数
      if (this.onUnmount.length > 0) {
        var result;
        for (var i in this.onUnmount) {
          // 如果this.onUnmount[i]不是函数，或者onunmount返回false，result就为false
          // result不为false，就能作为下一个onunmount的参数
          result = isFunction(this.onUnmount[i]) && this.onUnmount[i].call(this, result);
          // 如果 result 为false，表示不能unmount，停止unmount，并且返回false
          if (result === false) {
            return false;
          }
        }
      }
    };
  }

  /**
   * 判断参数是否是函数的数组，不是的话进行变换
   * @param {function || Array<function>} fns
   */
  function funcArray (fns) {
    var fnArr = fns;
    if (!isArray(fnArr)) {
      fnArr = isFunction(fnArr)? [fnArr]: [];
    }
    return fnArr;
  }

  /**
   * 返回一个判断某种类型的函数
   * @param {string} type
   */
  function typeOf (type) {
    return function (val) {
      if (Object.prototype.toString.call(val) === '[object '+type+']') {
        return true;
      }
      return false;
    }
  }
  // 判断是否是字符串类型的函数
  var isString = typeOf('String'),
      isFunction = typeOf('Function'),
      isArray = typeOf('Array');

  /**
   * 函数组合，传入一个函数的数组，返回一个函数
   * 返回的函数将从按数组降序方向调用函数，前一个函数的结果作为后一个函数的参数
   */
  function fcompose () {
    var _funcs = Array.prototype.slice.call(arguments);
    return function () {
      var args = arguments;
      for (var i = _funcs.length - 1; i >= 0; i--) {
        _funcs[i] && isFunction(_funcs[i]) && (args = [_funcs[i].apply(this, args)]);
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
        _funcs[i] && isFunction(_funcs[i]) && (args = [_funcs[i].apply(this, args)]);
      }
      return args[0];
    };
  }
  /**
   * 格式化路径
   */
  function formatPath (path) {
    // path都不是#开头
    var availPath = path[0] === '#'? path.slice(1): path;
    // 不是以 / 结尾
    availPath = availPath[availPath.length-1] === '/' && availPath.length > 1
      ? availPath.slice(0, availPath.length-1)
      : availPath;
    return availPath;
  }

  /**
   * @param routes 路由键值对 path: function / Array<function>
   */
  Router = function (routes) {
    routes = routes? routes: {};
    // table，路由表，path: Route
    var table = {},
        redirectTable = {},
        // 根路径，如果没匹配到，就默认到该路径
        root = '/',
        // 对象中记录的都不是#开头的
        // 当前路由
        currentPath = '',
        // 上一个路由
        previewPath = '',
        // 路由改变后的路由参数键值对
        routeParam = {},
        listened = false,
        // 是否支持history
        historySupport = (window.history != null? window.history.pushState: null) != null;

    // 初始化路由对象
    init(routes);

    /**
     * 初始化路由器对象
     * @param {Object} routes 路径和函数的键值对
     */
    function init (routes) {
      for (var path in routes) {
        // 遍历路由参数
        if (routes.hasOwnProperty(path)) {
          var availPath = formatPath(path);
          // table和route记录的都是没有#开头/结尾的路由
          table[availPath] = new Route(availPath, routes[path]);
        }
      }
      // 开始监听路由变化
      // listen();
    }

    /**
     * 开始监听路由
     */
    function listen () {
      listened = true;
      // 没有hash路由，默认 root
      !location.hash && defaultHash();

      // 如果支持h5 history
      // onpopstate可以监视url、hash
      // hashchange只能监视hash
      if (historySupport) {
        setTimeout(function () {
          window.onpopstate = dispatchHash;
        }, 500);
      } else if (('onhashchange' in window) && ((typeof document.documentMode === 'undefined') || document.documentMode === 8)) {
        // documentMode 用来兼容ie
        window.onhashchange = dispatchHash;
      } else {
        // 没有 onhashchange方法，就设置定时器，手动检查hash变化
        setInterval(function () {
          var hash = formatPath(location.hash);
          if (hash !== currentPath) {
            dispatchHash();
          }
        }, 150);
      }

      // 此时，总是有hash，分发hash
      dispatchHash();
    }

    /**
     * hash改变后触发，进入路由选择
     */
    function dispatchHash () {
      // 清空路由参数
      routeParam = {};
      // 改变的hash
      var hash = formatPath(location.hash);
      if (currentPath !== hash) {
        // 更新previewPath和currentPath
        previewPath = currentPath;
        currentPath = hash;

        // 寻找和当前路由匹配的route对象
        var route = match(hash),
            prevRoute = match(previewPath);

        // 如果当前是默认路由，并且要跳转的路由不存在（跳到默认路由），就不卸载、加载
        if (!route && prevRoute && prevRoute.path === root) {
          // currentPath换成root，这样将hash换成root后就不会触发dispatch
          currentPath = root;
          defaultHash();
          return;
        }

        // 加载路由前，卸载当前路由
        // previewPath存在就调用onUnmount
        // 要卸载的路由对象必须存在，并且有onunmount对象
        if (prevRoute && prevRoute.onUnmount.length > 0 && prevRoute.unmount() === false) {
          // unmount失败
          return ;
        }

        // 调用当前路由的回调
        if (route) {
          // 返回false，mount失败
          route.mount(routeParam);
        } else {
          // 要跳转的路由不存在
          defaultHash();
        }
      }
    }
    /**
     * 匹配table中的路由
     * @param {string} path 要匹配的路径字符串
     */
    function match (path) {
      if (!path) {
        return;
      }
      // 遍历table
      for (var hash in table) {
        if (table.hasOwnProperty(hash)) {
          var route = table[hash],
              // 匹配路径字符串，并返回路径的参数
              // 不匹配返回null，没参数返回空对象
              param = matchPath(path, hash, route.params);
          // 根据matchPath的返回做判断
          if (param) {
            // 有参数，就更新路由参数对象
            routeParam = param;
            return route;
          }
        }
      }
      return ;
    }

    /**
     * 匹配路径，并且找到其中的参数
     * @param {string} path 要匹配的hash
     * @param {string} hash table的key
     */
    function matchPath (path, hash, paramArr) {
      // 判断当前匹配的路由是否有参数
      if (hash.match(/\{([_a-zA-Z]+)\}/g)) {
        // 将比较的两个路径按 / 分割
        var hashParts = hash.split('/'),
            pathParts = path.split('/'),
            // 路由中提取的参数对象
            params = {},
            paramIndex = 0;
        // 两个parts的长度不同，就直接返回null
        if (hashParts.length !== pathParts.length) {
          return null;
        }
        // 遍历table中的路径的part
        for (var i in hashParts) {
          var part = hashParts[i];
          // 如果该part是参数
          if (part[0] === '{') {
            // 在params中记录参数
            params[paramArr[paramIndex]] = pathParts[i];
            paramIndex++;
          } else if (part !== pathParts[i]) {
            // 不是参数，并且part也不同，就匹配失败
            return null;
          }
        }
        return params;
      } else {
        // 没有参数，就直接比较路径字符串
        return path === hash? {}: null;
      }
    }
    /**
     * 跳转到默认hash
     */
    function defaultHash () {
      location.hash = '#'+root;
    }

    /**
     * 开始监听
     */
    this.listen = function () {
      !listened && listen();
      return this;
    };
    /**
     * 指定默认路由
     */
    this.otherwise = function (path) {
      root = formatPath(path);
      return this;
    };
    /**
     * 添加一个路由配置
     */
    this.route = function (pathConfig) {
      if (!pathConfig || !pathConfig.path) {
        return;
      }
      var path = formatPath(pathConfig.path),
          route;
      // 如果table中存在path
      if (table[path]) {
        route = table[path];
        // 给table中添加属性
        route.mounted = route.mounted.concat(funcArray(pathConfig.mounted));
        route.onMount = route.onMount.concat(funcArray(pathConfig.onMount));
        route.onUnmount = route.onUnmount.concat(funcArray(pathConfig.onUnmount));
      } else {
        // 如果table中不存在该配置，就创建Route对象
        route = new Route(path, pathConfig.mounted);
        // 添加onMount，onUnmount属性
        route.onMount = funcArray(pathConfig.onMount);
        route.onUnmount = funcArray(pathConfig.onUnmount);
        // 注册到table中
        table[path] = route;
      }
      return this;
    };
    /**
     * 路由跳转
     */
    this.go = function (path) {
      if(historySupport){
        history.pushState({}, document.title, '#'+path);
        dispatchHash();
      } else {
        location.hash = "#" + path;
      }
    };
  };

  return Router;
});
